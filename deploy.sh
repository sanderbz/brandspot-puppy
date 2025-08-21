#!/usr/bin/env bash
set -Eeuo pipefail

# BrandSpot Puppy – Local wrapper (run on your Mac or CI)
# - Copies server-deploy.sh to the server and executes it idempotently

SERVER_USER_HOST="${SERVER_USER_HOST:-deploy@91.99.182.20}"
APP_DIR_REMOTE="${APP_DIR_REMOTE:-/opt/brandspot-puppy}"
REPO_URL="${REPO_URL:-https://github.com/sanderbz/brandspot-puppy}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3000}"

WRK_DIR_REMOTE="/tmp/brandspot-puppy-deploy"
SERVER_SCRIPT_REMOTE="${WRK_DIR_REMOTE}/server-deploy.sh"

log() { echo "[local-deploy] $*"; }
fail() { echo "[local-deploy] ERROR: $*" >&2; exit 1; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"; }

main() {
  require_cmd ssh
  require_cmd scp

  if [[ ! -f server-deploy.sh ]]; then
    fail "server-deploy.sh not found next to this script."
  fi

  log "Creating remote work dir"
  ssh -o StrictHostKeyChecking=accept-new "${SERVER_USER_HOST}" "sudo mkdir -p '${WRK_DIR_REMOTE}' && sudo chown \"$(id -un)\":www-data '${WRK_DIR_REMOTE}' || true"

  log "Uploading server-deploy.sh"
  scp -q server-deploy.sh "${SERVER_USER_HOST}:${SERVER_SCRIPT_REMOTE}"
  ssh "${SERVER_USER_HOST}" "sudo chmod +x '${SERVER_SCRIPT_REMOTE}'"

  log "Executing remote server-deploy.sh"
  ssh "${SERVER_USER_HOST}" "\
    sudo APP_DIR='${APP_DIR_REMOTE}' REPO_URL='${REPO_URL}' BRANCH='${BRANCH}' PORT='${PORT}' '${SERVER_SCRIPT_REMOTE}'"

  log "Done. Service logs: sudo journalctl -u brandspot-puppy -f"
}

main "$@"


