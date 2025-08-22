#!/usr/bin/env bash
set -Eeuo pipefail

# BrandSpot Puppy – Server Autodeploy Script (run on the server)
# - Idempotent: clones repo if missing, installs system deps, ensures Node via nvm, installs JS deps, builds, writes systemd unit, starts and health-checks

APP_DIR="${APP_DIR:-/opt/brandspot-puppy}"
SERVICE_NAME="brandspot-puppy.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"
ENV_DIR="/etc/brandspot"
ENV_FILE="${ENV_DIR}/puppy.env"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_HOME="$(eval echo ~${DEPLOY_USER})"
NVM_DIR="${DEPLOY_HOME}/.nvm"
LOG_DIR="/var/log/brandspot"
PORT="${PORT:-3000}"
REPO_URL="${REPO_URL:-https://github.com/sanderbz/brandspot-puppy}"
BRANCH="${BRANCH:-main}"

NODE_BIN=""
ENTRYPOINT_PATH=""

log() { echo "[server-deploy] $*"; }
fail() { echo "[server-deploy] ERROR: $*" >&2; exit 1; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"; }

ensure_root_capabilities() {
  if [[ $(id -u) -ne 0 ]]; then
    require_cmd sudo
    sudo -n true 2>/dev/null || fail "This script needs passwordless sudo for provisioning. Run as a user with sudo NOPASSWD or execute as root."
  fi
}

pkg_install_debian() {
  sudo apt-get update -y
  sudo apt-get install -y \
    ca-certificates curl gnupg lsof \
    fontconfig fonts-liberation \
    libx11-6 libx11-xcb1 libnss3 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
    libgbm1 libgtk-3-0 libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libatspi2.0-0 libglib2.0-0 jq || true
  # asound package name differs on Ubuntu 24.04 (libasound2t64)
  sudo apt-get install -y libasound2t64 || sudo apt-get install -y libasound2 || true
}

pkg_install_rhel() {
  local pm="dnf"
  command -v dnf >/dev/null 2>&1 || pm="yum"
  sudo ${pm} -y install \
    ca-certificates curl lsof \
    fontconfig liberation-fonts \
    libX11 libX11-xcb nss atk at-spi2-atk libXcomposite libXdamage libXfixes \
    mesa-libgbm gtk3 alsa-lib libXrandr pango pango-tools glib2 jq || true
}

install_system_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing system packages (Debian/Ubuntu)"
    pkg_install_debian
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    log "Installing system packages (RHEL/CentOS/Fedora)"
    pkg_install_rhel
  else
    log "Unknown distro; skipping system package install"
  fi
}

ensure_paths_and_dirs() {
  if [[ ! -d "${APP_DIR}" ]]; then
    log "App directory missing; cloning ${REPO_URL} (branch ${BRANCH})"
    require_cmd git
    sudo mkdir -p "$(dirname "${APP_DIR}")"
    sudo chown "${DEPLOY_USER}:${DEPLOY_USER}" "$(dirname "${APP_DIR}")" || sudo chown "${DEPLOY_USER}:www-data" "$(dirname "${APP_DIR}")" || true
    sudo -u "${DEPLOY_USER}" bash -lc "\
      set -Eeuo pipefail; \
      git clone --branch '${BRANCH}' --depth 1 '${REPO_URL}' '${APP_DIR}'"
  else
    log "App directory exists: ${APP_DIR} (skipping clone)"
  fi

  sudo mkdir -p "${LOG_DIR}"
  sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${LOG_DIR}"

  sudo mkdir -p "${ENV_DIR}"
}

update_repo() {
  if [[ -d "${APP_DIR}/.git" ]]; then
    log "Updating repository to ${BRANCH}"
    sudo -u "${DEPLOY_USER}" bash -lc "\
      set -Eeuo pipefail; \
      cd '${APP_DIR}'; \
      git remote set-url origin '${REPO_URL}' || true; \
      git fetch --prune origin; \
      git reset --hard "origin/${BRANCH}"; \
      git clean -fdx || true" || fail "Failed to update repository"
  else
    log "Not a git repo; skipping update"
  fi
}

ensure_node_runtime() {
  if [[ -s "${NVM_DIR}/nvm.sh" ]] && \
     sudo -u "${DEPLOY_USER}" bash -lc "source '${NVM_DIR}/nvm.sh'; nvm ls 20.17.0 >/dev/null 2>&1"; then
    log "Found Node 20.17.0 via nvm"
    sudo -u "${DEPLOY_USER}" bash -lc "source '${NVM_DIR}/nvm.sh'; nvm use 20.17.0 >/dev/null"
    return
  fi

  log "Installing nvm and Node 20.17.0 for ${DEPLOY_USER}"
  if [[ ! -s "${NVM_DIR}/nvm.sh" ]]; then
    sudo -u "${DEPLOY_USER}" bash -lc "\
      set -Eeuo pipefail; \
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  fi
  sudo -u "${DEPLOY_USER}" bash -lc "\
    set -Eeuo pipefail; \
    source '${NVM_DIR}/nvm.sh'; \
    nvm install 20.17.0; \
    nvm alias default 20.17.0; \
    node -v; \
    true"
}

resolve_node_bin() {
  local candidate
  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    candidate=$(sudo -u "${DEPLOY_USER}" bash -lc "source '${NVM_DIR}/nvm.sh'; nvm which 20.17.0 2>/dev/null || true")
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then NODE_BIN="${candidate}"; return; fi
  fi
  candidate="${DEPLOY_HOME}/.nvm/versions/node/v20.17.0/bin/node"
  if [[ -x "${candidate}" ]]; then NODE_BIN="${candidate}"; return; fi
  candidate=$(command -v node || true)
  if [[ -n "${candidate}" ]]; then NODE_BIN="${candidate}"; return; fi
  fail "Unable to resolve Node binary path"
}

detect_entrypoint() {
  if [[ -f "${APP_DIR}/dist/server.js" ]]; then
    ENTRYPOINT_PATH="${APP_DIR}/dist/server.js"
  elif [[ -f "${APP_DIR}/server.js" ]]; then
    ENTRYPOINT_PATH="${APP_DIR}/server.js"
  else
    fail "Entrypoint not found: expected dist/server.js or server.js in ${APP_DIR}"
  fi
}

write_env_file() {
  log "Writing ${ENV_FILE}"
  sudo tee "${ENV_FILE}" >/dev/null <<EOF
NODE_ENV=production
PORT=${PORT}
HOST=127.0.0.1
HEADLESS=true
# Temporary debug logging for deployment validation
DEBUG_DEPLOY=${DEBUG_DEPLOY:-false}
EOF
  sudo chmod 0644 "${ENV_FILE}"
}

ensure_chromium_and_env() {
  # Standard ARM64 solution: use system Chromium (Chrome has no official ARM64 Linux builds)
  log "Configuring system Chromium for ARM64 compatibility"
  
  # Clean Puppeteer cache (x86_64 Chrome won't work on ARM64)
  log "Cleaning incompatible Puppeteer Chrome cache"
  sudo -u "${DEPLOY_USER}" rm -rf "/home/${DEPLOY_USER}/.cache/puppeteer" || true
  
  # Install system Chromium for ARM64
  log "Installing system Chromium (ARM64 compatible)"
  sudo apt-get update -y || true
  sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium || true
  
  # Find system chromium path
  local chromium_path=""
  if command -v chromium-browser >/dev/null 2>&1; then
    chromium_path="$(command -v chromium-browser)"
  elif command -v chromium >/dev/null 2>&1; then
    chromium_path="$(command -v chromium)"
  else
    fail "Failed to install system Chromium"
  fi
  
  # Verify system chromium works on ARM64
  log "Testing system Chromium: ${chromium_path}"
  if sudo -u "${DEPLOY_USER}" "${chromium_path}" --version >/dev/null 2>&1; then
    log "System Chromium verification: PASSED"
  else
    fail "System Chromium verification: FAILED"
  fi
  
  # Configure Puppeteer to use system Chromium (standard ARM64 solution)
  sudo sed -i '/^PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=/d' "${ENV_FILE}" || true
  echo "PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true" | sudo tee -a "${ENV_FILE}" >/dev/null
  
  sudo sed -i '/^PUPPETEER_EXECUTABLE_PATH=/d' "${ENV_FILE}" || true  
  echo "PUPPETEER_EXECUTABLE_PATH=${chromium_path}" | sudo tee -a "${ENV_FILE}" >/dev/null
  
  log "Configured Puppeteer to use system Chromium (ARM64 compatible)"
}

write_systemd_unit() {
  log "Writing systemd unit: ${SERVICE_FILE} (Node: ${NODE_BIN}, Entrypoint: ${ENTRYPOINT_PATH})"
  sudo tee "${SERVICE_FILE}" >/dev/null <<EOF
[Unit]
Description=BrandSpot Puppy Crawler
After=network-online.target
Wants=network-online.target

[Service]
User=${DEPLOY_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${NODE_BIN} ${ENTRYPOINT_PATH}
Restart=always
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=3
# Chrome-friendly systemd settings
ProtectSystem=false
ProtectHome=false
PrivateTmp=false
MemoryDenyWriteExecute=false
RestrictRealtime=false
SystemCallFilter=

[Install]
WantedBy=multi-user.target
EOF
}

stop_existing_service() {
  log "Stopping existing service (if running)"
  sudo systemctl stop "${SERVICE_NAME}" || true
  # Wait up to 10s for port to be freed
  for i in {1..10}; do
    if command -v ss >/dev/null 2>&1; then
      if ! ss -ltn | awk '{print $4}' | grep -q ":${PORT}$"; then return 0; fi
    elif command -v lsof >/dev/null 2>&1; then
      if ! lsof -i ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
    else
      return 0
    fi
    sleep 1
  done
  log "Port ${PORT} still appears in use after stop; proceeding to check."
}

install_node_dependencies() {
  log "Installing Node dependencies (skipping Chrome download)"
  # Skip Puppeteer Chrome download since we're using system Chromium
  sudo -u "${DEPLOY_USER}" bash -lc "\
    set -Eeuo pipefail; \
    source '${NVM_DIR}/nvm.sh'; \
    cd '${APP_DIR}'; \
    export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true; \
    if [[ -f package-lock.json ]]; then npm ci || npm install; else npm install; fi;"
}

run_build_if_available() {
  log "Checking for build script"
  if [[ -f "${APP_DIR}/package.json" ]] && grep -q '"build"' "${APP_DIR}/package.json"; then
    log "Running build"
    sudo -u "${DEPLOY_USER}" bash -lc "\
      set -Eeuo pipefail; \
      source '${NVM_DIR}/nvm.sh'; \
      cd '${APP_DIR}'; \
      npm run -s build;"
  else
    log "No build script found; skipping build"
  fi
}

reload_enable_start() {
  log "Reloading systemd daemon"
  sudo systemctl daemon-reload
  sudo systemctl enable "${SERVICE_NAME}"
  log "Starting service"
  sudo systemctl start "${SERVICE_NAME}"
}

wait_for_port() {
  log "Waiting for port ${PORT} to be listening"
  for i in {1..60}; do
    if command -v ss >/dev/null 2>&1; then
      if ss -ltn | awk '{print $4}' | grep -q ":${PORT}$"; then return 0; fi
    elif command -v lsof >/dev/null 2>&1; then
      if lsof -i ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
    else
      sleep 1; continue
    fi
    sleep 1
  done
  return 1
}

health_check() {
  log "Running health check"
  require_cmd curl
  for i in {1..30}; do
    if command -v jq >/dev/null 2>&1; then
      if curl -fsS "http://127.0.0.1:${PORT}/health" | jq -e '.status=="ok"' >/dev/null 2>&1; then
        log "Health check OK"
        return 0
      fi
    else
      if curl -fsS "http://127.0.0.1:${PORT}/health" | grep -qi '"status"[[:space:]]*:[[:space:]]*"ok"'; then
        log "Health check OK"
        return 0
      fi
    fi
    log "waiting..."
    sleep 1
  done
  log "Health endpoint not available; trying test crawl"
  if curl -fsS -X POST "http://127.0.0.1:${PORT}/crawl" -H 'Content-Type: application/json' -d '{"url":"https://example.com","test":true}' >/dev/null 2>&1; then
    log "Test crawl request accepted"
    return 0
  fi
  log "Service did not report healthy in time; showing recent logs"
  sudo journalctl -u "${SERVICE_NAME}" -n 50 --no-pager || true
  fail "Health check failed"
}

sample_page_check() {
  log "Fetching sample page via /test-crawl (expect title=SIDN and IP present)"
  require_cmd curl
  local resp
  resp=$(curl -fsS "http://127.0.0.1:${PORT}/test-crawl" || true)
  if [[ -z "$resp" ]]; then
    fail "Empty response from /test-crawl"
  fi
  if command -v jq >/dev/null 2>&1; then
    local ok title ip
    ok=$(printf '%s' "$resp" | jq -r '.ok // false')
    title=$(printf '%s' "$resp" | jq -r '.title // ""')
    ip=$(printf '%s' "$resp" | jq -r '.ip // ""')
    if [[ "$ok" != "true" || "$title" != "SIDN" || -z "$ip" ]]; then
      log "Response:"; printf '%s\n' "$resp"
      fail "/test-crawl validation failed (ok=true, title=SIDN, ip non-empty required)"
    fi
    log "Sample title: ${title}"
    log "Sample IP: ${ip}"
  else
    echo "$resp" | grep -q '"ok"[[:space:]]*:[[:space:]]*true' || fail "/test-crawl not ok"
    echo "$resp" | grep -q '"title"[[:space:]]*:[[:space:]]*"SIDN"' || fail "/test-crawl wrong title"
    echo "$resp" | grep -q '"ip"[[:space:]]*:[[:space:]]*"[^"]\+"' || fail "/test-crawl missing IP"
    log "Sample response: $resp"
  fi
}

check_port_free_or_stop() {
  stop_existing_service
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn | awk '{print $4}' | grep -q ":${PORT}$"; then
      log "Port ${PORT} is in use by another process:"
      ss -ltnp | grep ":${PORT} " || true
      fail "Port ${PORT} is in use. Please free it before deploying."
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -i ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      log "Port ${PORT} is in use by another process:"
      lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN || true
      fail "Port ${PORT} is in use. Please free it before deploying."
    fi
  fi
}

main() {
  ensure_root_capabilities
  ensure_paths_and_dirs
  install_system_packages
  ensure_node_runtime
  write_env_file
  # Stop early to free the port before proceeding
  stop_existing_service
  update_repo
  install_node_dependencies
  ensure_chromium_and_env
  run_build_if_available
  detect_entrypoint
  resolve_node_bin
  write_systemd_unit
  check_port_free_or_stop
  reload_enable_start
  if ! wait_for_port; then
    log "Service did not open port in time; recent logs:"
    sudo journalctl -u "${SERVICE_NAME}" -n 200 --no-pager || true
    fail "Port ${PORT} did not open"
  fi
  health_check
  sample_page_check
  log "Deployment complete. Follow logs with: sudo journalctl -u ${SERVICE_NAME} -f"
}

main "$@"


