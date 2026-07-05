#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-}"
RESTORE_CONFIRM="${RESTORE_CONFIRM:-}"
RESTORE_FILES="${RESTORE_FILES:-false}"
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

latest_match() {
  local pattern="$1"
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" | sort | tail -n 1
}

require_confirmation() {
  if [[ "$RESTORE_CONFIRM" != "restore-all-my-gear" ]]; then
    fail "Refusing to restore without RESTORE_CONFIRM=restore-all-my-gear"
  fi
}

restore_database() {
  local dump_file="$1"

  log "Verifying PostgreSQL dump listing: $dump_file"
  docker exec -i "$DB_CONTAINER" pg_restore -l < "$dump_file" >/dev/null

  log "Restoring PostgreSQL database: $DB_NAME"
  docker exec -i "$DB_CONTAINER" pg_restore --clean --if-exists --no-owner --no-privileges -U "$DB_USER" -d "$DB_NAME" < "$dump_file"
}

restore_archive_if_exists() {
  local label="$1"
  local pattern="$2"
  local target_parent="$3"
  local archive

  archive="$(latest_match "$pattern")"
  if [[ -z "$archive" ]]; then
    log "Skip $label restore: archive not found: $pattern"
    return 0
  fi

  mkdir -p "$target_parent"
  log "Restoring $label archive into $target_parent: $archive"
  tar -xzf "$archive" -C "$target_parent"
}

main() {
  require_command docker
  require_command find
  require_command sort
  require_command tail
  require_command tar

  [[ -n "$BACKUP_DIR" ]] || fail "BACKUP_DIR is required"
  [[ -d "$BACKUP_DIR" ]] || fail "Backup directory not found: $BACKUP_DIR"
  [[ -d "$SUPABASE_DIR" ]] || fail "Supabase directory not found: $SUPABASE_DIR"
  container_exists "$DB_CONTAINER" || fail "Docker container is not running: $DB_CONTAINER"
  require_confirmation

  local dump_file
  dump_file="$(latest_match 'postgres_*.dump')"
  [[ -n "$dump_file" ]] || fail "PostgreSQL dump not found in $BACKUP_DIR"

  log "Backup directory: $BACKUP_DIR"
  log "Supabase directory: $SUPABASE_DIR"
  log "Database target: container=$DB_CONTAINER db=$DB_NAME user=$DB_USER"
  log "Checking database connection"
  docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

  restore_database "$dump_file"

  if [[ "$RESTORE_FILES" == "true" || "$RESTORE_FILES" == "1" ]]; then
    restore_archive_if_exists "supabase_storage" 'supabase_storage_*.tar.gz' "$SUPABASE_DIR/volumes"
    restore_archive_if_exists "supabase_minio" 'supabase_minio_*.tar.gz' "$SUPABASE_DIR/volumes"
  else
    log "Skip file restore: set RESTORE_FILES=true to restore storage/minio archives"
  fi

  log "Restore completed"
}

main "$@"
