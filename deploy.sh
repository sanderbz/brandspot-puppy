#!/usr/bin/env bash
set -Eeuo pipefail

# BrandSpot Puppy – Autodeploy Script
# - Optional provisioning of system deps (use --provision)
# - Uses Node 20.17.0 via nvm for the deploy user (installs only with --install-node)
# - Installs JS deps (pnpm preferred; falls back to npm)
# - Optional clone if APP_DIR missing (use --clone --repo <url> [--branch main])
# - Creates env file and systemd unit (dynamic entrypoint: dist/server.js or server.js)
# - Starts and health-checks the service (/health then fallback to /crawl test)

APP_DIR="/opt/brandspot-puppy"
SERVICE_NAME="brandspot-puppy.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"
ENV_DIR="/etc/brandspot"
ENV_FILE="${ENV_DIR}/puppy.env"
DEPLOY_USER="deploy"
DEPLOY_HOME="$(eval echo ~${DEPLOY_USER})"
NVM_DIR="${DEPLOY_HOME}/.nvm"
LOG_DIR="/var/log/brandspot"
PORT="3000"
REPO_URL=""
BRANCH="main"

FLAG_PROVISION=0
FLAG_INSTALL_NODE=0
FLAG_CLONE=0

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

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
    libgbm1 libgtk-3-0 libasound2 libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 libatspi2.0-0 libglib2.0-0
}

pkg_install_rhel() {
  local pm="dnf"
  command -v dnf >/dev/null 2>&1 || pm="yum"
  sudo ${pm} -y install \
    ca-certificates curl lsof \
    fontconfig liberation-fonts \
    libX11 libX11-xcb nss atk at-spi2-atk libXcomposite libXdamage libXfixes \
    mesa-libgbm gtk3 alsa-lib libXrandr pango pango-tools glib2
}

install_system_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing system packages (Debian/Ubuntu)"
    pkg_install_debian
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    log "Installing system packages (RHEL/CentOS/Fedora)"
    pkg_install_rhel
  else
    fail "Unsupported distro. Please install Chromium deps and curl manually."
  fi
}

ensure_paths_and_dirs() {
  if [[ ! -d "${APP_DIR}" ]]; then
    if [[ ${FLAG_CLONE} -eq 1 && -n "${REPO_URL}" ]]; then
      log "Cloning repository ${REPO_URL} into ${APP_DIR} (branch ${BRANCH})"
      require_cmd git
      sudo -u "${DEPLOY_USER}" bash -lc "\
        set -Eeuo pipefail; \
        git clone --branch '${BRANCH}' --depth 1 '${REPO_URL}' '${APP_DIR}'"
    else
      fail "App directory not found: ${APP_DIR}. Provide --clone --repo <url> [--branch main] to clone."
    fi
  fi

  # Create logging dir for future use; journald is default
  sudo mkdir -p "${LOG_DIR}"
  sudo chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${LOG_DIR}"

  sudo mkdir -p "${ENV_DIR}"
}

ensure_node_runtime() {
  # Validate existing nvm and Node 20.17.0; optionally install when requested
  if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
    if sudo -u "${DEPLOY_USER}" bash -lc "source '${NVM_DIR}/nvm.sh'; nvm ls 20.17.0 >/dev/null 2>&1"; then
      log "Found Node 20.17.0 via nvm"
      sudo -u "${DEPLOY_USER}" bash -lc "source '${NVM_DIR}/nvm.sh'; nvm use 20.17.0 >/dev/null; corepack enable || true; corepack prepare pnpm@latest --activate || true"
      return
    fi
  fi

  if [[ ${FLAG_INSTALL_NODE} -eq 1 ]]; then
    log "Installing Node 20.17.0 via nvm for ${DEPLOY_USER}"
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
      corepack enable || true; \
      corepack prepare pnpm@latest --activate || true"
  else
    fail "Node 20.17.0 via nvm not found for user '${DEPLOY_USER}'. Re-run with --install-node to install."
  fi
}

write_env_file() {
  log "Writing ${ENV_FILE}"
  sudo tee "${ENV_FILE}" >/dev/null <<EOF
NODE_ENV=production
PORT=${PORT}
HOST=127.0.0.1
HEADLESS=true
EOF
  sudo chmod 0644 "${ENV_FILE}"
}

write_systemd_unit() {
  log "Writing systemd unit: ${SERVICE_FILE}"
  sudo tee "${SERVICE_FILE}" >/dev/null <<EOF
[Unit]
Description=BrandSpot Puppy Crawler
After=network-online.target
Wants=network-online.target

[Service]
User=${DEPLOY_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=/bin/bash -lc 'source "${NVM_DIR}/nvm.sh" && cd "${APP_DIR}" && if [[ -f dist/server.js ]]; then exec node dist/server.js; else exec node server.js; fi'
Restart=always
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=3
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
EOF
}

stop_existing_service() {
  if systemctl list-unit-files | grep -q "^${SERVICE_NAME}"; then
    log "Stopping existing service (if running)"
    sudo systemctl stop "${SERVICE_NAME}" || true
  fi
}

install_node_dependencies() {
  log "Installing Node dependencies"
  # Prefer pnpm if available via corepack; otherwise fallback to npm
  sudo -u "${DEPLOY_USER}" bash -lc "\
    set -Eeuo pipefail; \
    source '${NVM_DIR}/nvm.sh'; \
    cd '${APP_DIR}'; \
    if command -v pnpm >/dev/null 2>&1; then \
      pnpm install --frozen-lockfile || pnpm install; \
    else \
      if [[ -f package-lock.json ]]; then npm ci || npm install; else npm install; fi; \
    fi"
}

run_build_if_available() {
  log "Checking for build script"
  if [[ -f "${APP_DIR}/package.json" ]] && grep -q '"build"' "${APP_DIR}/package.json"; then
    log "Running build"
    sudo -u "${DEPLOY_USER}" bash -lc "\
      set -Eeuo pipefail; \
      source '${NVM_DIR}/nvm.sh'; \
      cd '${APP_DIR}'; \
      if command -v pnpm >/dev/null 2>&1; then \
        pnpm -s build; \
      else \
        npm run -s build; \
      fi"
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
    if curl -fsS "http://127.0.0.1:${PORT}/health" | grep -q '"status"\s*:\s*"ok"'; then
      log "Health check OK"
      return 0
    fi
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

check_port_free_or_stop() {
  # Stop existing service first to free the port if it's ours
  stop_existing_service
  # Sanity: port should be free now
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn | awk '{print $4}' | grep -q ":${PORT}$"; then
      fail "Port ${PORT} is in use. Please free it before deploying."
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -i ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      fail "Port ${PORT} is in use. Please free it before deploying."
    fi
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --provision) FLAG_PROVISION=1; shift ;;
      --install-node) FLAG_INSTALL_NODE=1; shift ;;
      --clone) FLAG_CLONE=1; shift ;;
      --repo) REPO_URL="$2"; shift 2 ;;
      --branch) BRANCH="$2"; shift 2 ;;
      --app-dir) APP_DIR="$2"; shift 2 ;;
      --port) PORT="$2"; shift 2 ;;
      *) fail "Unknown option: $1" ;;
    esac
  done
}

main() {
  parse_args "$@"
  ensure_root_capabilities
  ensure_paths_and_dirs
  if [[ ${FLAG_PROVISION} -eq 1 ]]; then install_system_packages; else log "Skipping system provisioning (use --provision to enable)"; fi
  ensure_node_runtime
  write_env_file
  write_systemd_unit
  check_port_free_or_stop
  install_node_dependencies
  run_build_if_available
  reload_enable_start
  wait_for_port || fail "Port ${PORT} did not open"
  health_check
  log "Deployment complete. Follow logs with: sudo journalctl -u ${SERVICE_NAME} -f"
}

main "$@"


