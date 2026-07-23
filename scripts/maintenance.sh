#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-status}"
MAINTENANCE_ROOT="${MAINTENANCE_ROOT:-/var/www/all-my-gear}"
MAINTENANCE_STATE_DIR="${MAINTENANCE_STATE_DIR:-/var/lib/all-my-gear}"
MAINTENANCE_FLAG="${MAINTENANCE_FLAG:-$MAINTENANCE_STATE_DIR/maintenance.enabled}"
MAINTENANCE_PAGE_SOURCE="${MAINTENANCE_PAGE_SOURCE:-$PROJECT_ROOT/nginx/maintenance.html}"
MAINTENANCE_PAGE_TARGET="${MAINTENANCE_PAGE_TARGET:-$MAINTENANCE_ROOT/maintenance.html}"
NGINX_BIN="${NGINX_BIN:-nginx}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

install_page() {
  [[ -f "$MAINTENANCE_PAGE_SOURCE" ]] || fail "Maintenance page not found: $MAINTENANCE_PAGE_SOURCE"
  install -d -m 755 "$MAINTENANCE_ROOT"
  install -d -m 755 "$MAINTENANCE_STATE_DIR"
  install -m 644 "$MAINTENANCE_PAGE_SOURCE" "$MAINTENANCE_PAGE_TARGET"
}

verify_nginx_config() {
  "$NGINX_BIN" -t
  if ! "$NGINX_BIN" -T 2>&1 | grep -Fq "$MAINTENANCE_FLAG"; then
    fail "Active nginx config does not reference maintenance flag: $MAINTENANCE_FLAG"
  fi
}

case "$ACTION" in
  install)
    install_page
    log "Maintenance page installed: $MAINTENANCE_PAGE_TARGET"
    ;;
  on)
    install_page
    verify_nginx_config
    touch "$MAINTENANCE_FLAG"
    chmod 644 "$MAINTENANCE_FLAG"
    log "Maintenance mode enabled: $MAINTENANCE_FLAG"
    ;;
  off)
    rm -f "$MAINTENANCE_FLAG"
    log "Maintenance mode disabled"
    ;;
  status)
    if [[ -f "$MAINTENANCE_FLAG" ]]; then
      log "Maintenance mode is ON"
      exit 0
    fi
    log "Maintenance mode is OFF"
    ;;
  *)
    fail "Usage: $0 {install|on|off|status}"
    ;;
esac
