#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"
DRY_RUN="${DRY_RUN:-false}"

detect_migrations_dir() {
  if [[ -n "${MIGRATIONS_DIR:-}" ]]; then
    printf '%s\n' "$MIGRATIONS_DIR"
  elif [[ -d /root/all-my-gear/migrations ]]; then
    printf '%s\n' /root/all-my-gear/migrations
  elif [[ -d /root/all-my-gear/supabase/migrations ]]; then
    printf '%s\n' /root/all-my-gear/supabase/migrations
  elif [[ -d "$PROJECT_ROOT/supabase/migrations" ]]; then
    printf '%s\n' "$PROJECT_ROOT/supabase/migrations"
  else
    printf '%s\n' "$PROJECT_ROOT/migrations"
  fi
}

MIGRATIONS_DIR="$(detect_migrations_dir)"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

checksum_command() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s\n' sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    printf '%s\n' "shasum -a 256"
  else
    fail "Required command not found: sha256sum or shasum"
  fi
}

container_exists() {
  docker ps --format '{{.Names}}' | grep -Fxq "$1"
}

read_migrations() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort
}

migration_checksum() {
  local migration="$1"
  local checksum_tool

  checksum_tool="$(checksum_command)"
  $checksum_tool "$migration" | awk '{print $1}'
}

schema_migrations_exists() {
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -At <<'SQL'
select case when to_regclass('public.schema_migrations') is null then 'false' else 'true' end;
SQL
}

migration_record_state() {
  local migration_name="$1"
  local migration_checksum="$2"

  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -At \
    -v migration_name="$migration_name" \
    -v migration_checksum="$migration_checksum" <<'SQL'
select case
  when not exists (
    select 1 from public.schema_migrations where filename = :'migration_name'
  ) then 'missing'
  when exists (
    select 1
    from public.schema_migrations
    where filename = :'migration_name'
      and checksum_sha256 = :'migration_checksum'
  ) then 'applied'
  else 'checksum_mismatch'
end;
SQL
}

record_migration() {
  local migration_name="$1"
  local migration_checksum="$2"

  if [[ "$(schema_migrations_exists)" != "true" ]]; then
    return 0
  fi

  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
    -v migration_name="$migration_name" \
    -v migration_checksum="$migration_checksum" <<'SQL'
insert into public.schema_migrations (filename, checksum_sha256)
values (:'migration_name', :'migration_checksum')
on conflict (filename) do nothing;
SQL
}

verify_rls_state() {
  log "Checking RLS state for advisor tables"
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<'SQL'
select n.nspname as schema,
       c.relname as table,
       c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('shared_items', 'public_gear_shares', 'gear_items', 'checklists')
order by c.relname;
SQL
}

main() {
  require_command docker
  require_command find
  require_command sort
  checksum_command >/dev/null

  [[ -d "$MIGRATIONS_DIR" ]] || fail "Migrations directory not found: $MIGRATIONS_DIR"

  mapfile -t migrations < <(read_migrations)
  [[ "${#migrations[@]}" -gt 0 ]] || fail "No SQL migrations found in $MIGRATIONS_DIR"

  log "Migrations directory: $MIGRATIONS_DIR"
  log "Database target: container=$DB_CONTAINER db=$DB_NAME user=$DB_USER"
  log "Make sure a fresh backup exists before applying migrations."

  if [[ "$DRY_RUN" == "true" || "$DRY_RUN" == "1" ]]; then
    log "DRY_RUN enabled; migrations will not be applied"
    printf '%s\n' "${migrations[@]}"
    exit 0
  fi

  container_exists "$DB_CONTAINER" || fail "Docker container is not running: $DB_CONTAINER"

  log "Checking database connection"
  docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

  for migration in "${migrations[@]}"; do
    migration_name="$(basename "$migration")"
    migration_checksum="$(migration_checksum "$migration")"

    if [[ "$(schema_migrations_exists)" == "true" ]]; then
      record_state="$(migration_record_state "$migration_name" "$migration_checksum")"
      case "$record_state" in
        applied)
          log "Skipping already recorded $migration_name"
          continue
          ;;
        missing)
          ;;
        checksum_mismatch)
          fail "Recorded checksum differs for $migration_name"
          ;;
        *)
          fail "Unexpected migration state for $migration_name: $record_state"
          ;;
      esac
    fi

    log "Applying $migration_name"
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -v migration_name="$migration_name" -v migration_checksum="$migration_checksum" < "$migration"
    record_migration "$migration_name" "$migration_checksum"
  done

  verify_rls_state
  log "Migrations completed"
}

main "$@"
