#!/usr/bin/env bash

set -Eeuo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/all-my-gear-backups}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$TIMESTAMP"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
DB_NAME="${DB_NAME:-postgres}"
DB_USER="${DB_USER:-postgres}"

detect_supabase_dir() {
  if [[ -n "${SUPABASE_DIR:-}" ]]; then
    printf '%s\n' "$SUPABASE_DIR"
  elif [[ -d /root/all-my-gear/volumes ]]; then
    printf '%s\n' /root/all-my-gear
  elif [[ -d "$PROJECT_ROOT/supabase/volumes" ]]; then
    printf '%s\n' "$PROJECT_ROOT/supabase"
  else
    printf '%s\n' "$PROJECT_ROOT"
  fi
}

SUPABASE_DIR="$(detect_supabase_dir)"

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

archive_dir_if_exists() {
  local label="$1"
  local path="$2"
  local output="$BACKUP_DIR/${label}_${TIMESTAMP}.tar.gz"

  if [[ ! -d "$path" ]]; then
    log "Skip $label: directory does not exist: $path"
    return 0
  fi

  log "Archiving $label: $path"
  tar -C "$(dirname "$path")" -czf "$output" "$(basename "$path")"
  tar -tzf "$output" >/dev/null
  log "Created $output"
}

write_manifest() {
  local manifest="$BACKUP_DIR/manifest.txt"

  {
    echo "timestamp=$TIMESTAMP"
    echo "backup_dir=$BACKUP_DIR"
    echo "project_root=$PROJECT_ROOT"
    echo "supabase_dir=$SUPABASE_DIR"
    echo "db_container=$DB_CONTAINER"
    echo "db_name=$DB_NAME"
    echo "db_user=$DB_USER"
    echo
    echo "docker_containers:"
    docker ps --format '  {{.Names}} {{.Image}} {{.Status}}'
    echo
    echo "files:"
    find "$BACKUP_DIR" -maxdepth 1 -type f -print | sort
  } > "$manifest"

  log "Created $manifest"
}

main() {
  require_command docker
  require_command tar
  require_command find

  [[ -d "$SUPABASE_DIR" ]] || fail "Supabase directory not found: $SUPABASE_DIR"
  container_exists "$DB_CONTAINER" || fail "Docker container is not running: $DB_CONTAINER"

  mkdir -p "$BACKUP_DIR"

  log "Backup directory: $BACKUP_DIR"
  log "Checking database connection"
  docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

  log "Dumping PostgreSQL database: $DB_NAME"
  docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc \
    > "$BACKUP_DIR/postgres_${TIMESTAMP}.dump"

  log "Verifying PostgreSQL dump listing"
  docker exec -i "$DB_CONTAINER" pg_restore -l \
    < "$BACKUP_DIR/postgres_${TIMESTAMP}.dump" \
    > "$BACKUP_DIR/postgres_${TIMESTAMP}.dump.list"

  archive_dir_if_exists "supabase_storage" "$SUPABASE_DIR/volumes/storage"
  archive_dir_if_exists "supabase_minio" "$SUPABASE_DIR/volumes/minio"

  if [[ -f "$SUPABASE_DIR/.env" ]]; then
    log "Copying Supabase .env into backup with restricted permissions"
    install -m 600 "$SUPABASE_DIR/.env" "$BACKUP_DIR/supabase.env"
  else
    log "Skip .env copy: $SUPABASE_DIR/.env does not exist"
  fi

  write_manifest

  log "Backup completed"
  du -sh "$BACKUP_DIR"
}

main "$@"
