#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PREFERRED_PORT=8035
POLARPORT_URL="${POLARPORT_URL:-http://127.0.0.1:11050}"
POLARPROCESS_URL="${POLARPROCESS_URL:-http://127.0.0.1:11055}"

if [ "$#" -ne 0 ]; then
  echo "PolarMemory (PolarClaw/memory) lifecycle is managed by PolarProcess; do not pass arguments" >&2
  exit 2
fi

if ! curl -fsS --max-time 3 "$POLARPORT_URL/api/health" >/dev/null; then
  echo "PolarPort is unavailable; refusing unmanaged start." >&2
  exit 1
fi
if ! curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null; then
  echo "PolarProcess is unavailable; refusing unmanaged start." >&2
  exit 1
fi

if [ ! -f "$PROJECT_DIR/dist/api_server.js" ]; then
  echo "PolarMemory is not built; run npm ci && npm run build before start" >&2
  exit 1
fi

source "$HOME/Polarisor/Agent_core/scripts/port-claim.sh"
PORT="$(claim_port "polar-memory" "PolarMemory" "$PREFERRED_PORT")"
if [ "$PORT" -ne "$PREFERRED_PORT" ]; then
  release_port "$PORT"
  echo "PolarPort returned $PORT, but PolarMemory requires $PREFERRED_PORT" >&2
  exit 1
fi

cd "$PROJECT_DIR"
export PORT
export POLAR_RUNTIME_MANAGED=1
exec node dist/api_server.js
