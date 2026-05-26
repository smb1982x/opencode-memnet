#!/usr/bin/env bash
# scripts/install-client.sh — Install opencode-memnet plugin for OpenCode
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/tickernelz/opencode-mem/main/scripts/install-client.sh \
#     | OPENCODE_MEM_SERVER_URL=http://myserver:4747 OPENCODE_MEM_API_KEY=my-key bash
#
# Environment variables:
#   OPENCODE_MEM_SERVER_URL  — Server URL (default: http://localhost:4747)
#   OPENCODE_MEM_API_KEY     — API key for server authentication (required)

set -euo pipefail

SERVER_URL="${OPENCODE_MEM_SERVER_URL:-http://localhost:4747}"
API_KEY="${OPENCODE_MEM_API_KEY:-}"
CONFIG_DIR="${HOME}/.config/opencode"
CONFIG_FILE="${CONFIG_DIR}/opencode-memnet.jsonc"
JSON_FILE="${CONFIG_DIR}/opencode-memnet.json"

# Ensure config directory exists
mkdir -p "${CONFIG_DIR}"

if [ -z "${API_KEY}" ]; then
  echo "[opencode-memnet] WARNING: OPENCODE_MEM_API_KEY is not set."
  echo "[opencode-memnet] The plugin will not activate without an API key."
fi

# Write JSON config (takes precedence over .jsonc for override values)
cat > "${JSON_FILE}" << 'EOF'
{
  "serverUrl": "SERVER_URL_VALUE",
  "apiKey": "API_KEY_VALUE",
  "autoCaptureEnabled": true,
  "showAutoCaptureToasts": true
}
EOF
sed -i "s|SERVER_URL_VALUE|${SERVER_URL}|g" "${JSON_FILE}"
sed -i "s|API_KEY_VALUE|${API_KEY}|g" "${JSON_FILE}"

echo "[opencode-memnet] Client config written to ${JSON_FILE}"
echo "[opencode-memnet] Server URL: ${SERVER_URL}"
echo ""
echo "[opencode-memnet] Install complete. The plugin will activate on next OpenCode session."
