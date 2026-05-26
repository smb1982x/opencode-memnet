#!/usr/bin/env bash
# scripts/install-server.sh — Install opencode-memnet server via Docker Compose
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-server.sh \
#     | EMBEDDING_API_URL=https://api.openai.com/v1 \
#       EMBEDDING_MODEL=text-embedding-3-small \
#       EMBEDDING_API_KEY=sk-... \
#       SERVER_API_KEY=my-secret \
#       bash
#
# Required environment variables:
#   EMBEDDING_API_URL   — Embedding API endpoint
#   EMBEDDING_MODEL     — Embedding model name
#   EMBEDDING_API_KEY   — API key for embedding service
#   SERVER_API_KEY      — Secret key for server authentication (optional; warn if empty)
#
# Optional environment variables:
#   MEMORY_MODEL        — Chat model for auto-capture
#   MEMORY_API_URL      — Chat API URL
#   MEMORY_API_KEY      — Chat API key
#   SERVER_PORT         — Port (default: 4747)
#   OPENCODE_MEM_INSTALL_DIR — Install directory (default: ~/.opencode-memnet-server)

set -euo pipefail

: "${EMBEDDING_API_URL:?ERROR: EMBEDDING_API_URL is required}"
: "${EMBEDDING_MODEL:?ERROR: EMBEDDING_MODEL is required}"
: "${EMBEDDING_API_KEY:?ERROR: EMBEDDING_API_KEY is required}"
if [ -z "${SERVER_API_KEY:-}" ]; then
  echo "[opencode-memnet] WARNING: SERVER_API_KEY is not set. Set it or disable auth with DISABLE_WEBUI_AUTH=true and DISABLE_CLIENT_AUTH=true."
fi

INSTALL_DIR="${OPENCODE_MEM_INSTALL_DIR:-${HOME}/.opencode-memnet-server}"
SERVER_PORT="${SERVER_PORT:-4747}"

echo "[opencode-memnet] Installing server to ${INSTALL_DIR}..."

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "[opencode-memnet] ERROR: Docker is not installed. Please install Docker first."
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "[opencode-memnet] ERROR: Docker Compose is not available. Please install it."
  exit 1
fi

# Clone/update repo
if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "[opencode-memnet] Repository exists, pulling latest..."
  git -C "${INSTALL_DIR}" pull --ff-only
else
  echo "[opencode-memnet] Cloning repository..."
  git clone --depth 1 https://github.com/tickernelz/opencode-mem.git "${INSTALL_DIR}"
fi

# Create .env file
cat > "${INSTALL_DIR}/.env" << 'EOF'
EMBEDDING_API_URL=EMBEDDING_API_URL_VALUE
EMBEDDING_MODEL=EMBEDDING_MODEL_VALUE
EMBEDDING_API_KEY=EMBEDDING_API_KEY_VALUE
SERVER_API_KEY=SERVER_API_KEY_VALUE
SERVER_PORT=SERVER_PORT_VALUE
MEMORY_MODEL=MEMORY_MODEL_VALUE
MEMORY_API_URL=MEMORY_API_URL_VALUE
MEMORY_API_KEY=MEMORY_API_KEY_VALUE
POSTGRES_SSL=false
EOF
sed -i "s|EMBEDDING_API_URL_VALUE|${EMBEDDING_API_URL}|g" "${INSTALL_DIR}/.env"
sed -i "s|EMBEDDING_MODEL_VALUE|${EMBEDDING_MODEL}|g" "${INSTALL_DIR}/.env"
sed -i "s|EMBEDDING_API_KEY_VALUE|${EMBEDDING_API_KEY}|g" "${INSTALL_DIR}/.env"
sed -i "s|SERVER_API_KEY_VALUE|${SERVER_API_KEY}|g" "${INSTALL_DIR}/.env"
sed -i "s|SERVER_PORT_VALUE|${SERVER_PORT}|g" "${INSTALL_DIR}/.env"
sed -i "s|MEMORY_MODEL_VALUE|${MEMORY_MODEL:-}|g" "${INSTALL_DIR}/.env"
sed -i "s|MEMORY_API_URL_VALUE|${MEMORY_API_URL:-}|g" "${INSTALL_DIR}/.env"
sed -i "s|MEMORY_API_KEY_VALUE|${MEMORY_API_KEY:-}|g" "${INSTALL_DIR}/.env"

# Start services
echo "[opencode-memnet] Starting Docker services..."
docker compose -f "${INSTALL_DIR}/docker-compose.yml" up -d --build

echo ""
echo "[opencode-memnet] Server starting on http://localhost:${SERVER_PORT}"
echo "[opencode-memnet] WebUI:    http://localhost:${SERVER_PORT}/"
echo "[opencode-memnet] Health:   http://localhost:${SERVER_PORT}/api/health"
echo ""
echo "[opencode-memnet] Logs:  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
echo "[opencode-memnet] Stop:  docker compose -f ${INSTALL_DIR}/docker-compose.yml down"
