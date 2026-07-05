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

container_exists() {
  docker ps --format '{{.Names}}' | grep -Fxq "$1"
}

read_migrations() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort
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
    log "Applying $(basename "$migration")"
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 < "$migration"
  done

  verify_rls_state
  log "Migrations completed"
}

main "$@"
