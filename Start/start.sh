#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
POLARPORT_URL=${POLARPORT_URL:-http://127.0.0.1:11050}
PREFERRED_PORT=3910
NODE_BIN=${POLARCLAW_NODE_BIN:-~/.nvm/versions/node/v20.20.2/bin/node}

if [ "$#" -ne 0 ]; then
  echo "PolarClaw lifecycle is managed by PolarProcess; do not pass arguments" >&2
  exit 2
fi
if [ ! -x "$NODE_BIN" ]; then
  echo "PolarClaw Node executable missing: $NODE_BIN" >&2
  exit 1
fi
if [ "$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')" -ne 20 ]; then
  echo "PolarClaw installed native modules require Node 20" >&2
  exit 1
fi
if [ ! -f "$PROJECT_DIR/dist/main.js" ] || [ ! -f "$PROJECT_DIR/web/dist/index.html" ]; then
  echo "PolarClaw build artifacts are missing; run root and web builds before start" >&2
  exit 1
fi
if ! (cd "$PROJECT_DIR" && "$NODE_BIN" -e "require('better-sqlite3')"); then
  echo "better-sqlite3 is incompatible with $NODE_BIN; rebuild dependencies before start" >&2
  exit 1
fi
if ! curl -fsS --max-time 3 "$POLARPORT_URL/api/health" >/dev/null; then
  echo "PolarPort is unavailable; refusing preferred-port fallback" >&2
  exit 1
fi

source "$HOME/Polarisor/Agent_core/scripts/port-claim.sh"
PORT=$(claim_port "polarclaw" "PolarClaw" 3910)
if [ "$PORT" -ne "$PREFERRED_PORT" ]; then
  release_port "$PORT"
  echo "PolarPort returned $PORT, but PolarClaw requires $PREFERRED_PORT" >&2
  exit 1
fi

cd "$PROJECT_DIR"
export NODE_ENV=${NODE_ENV:-production}
export POLARISOR_ROOT=${POLARISOR_ROOT:-$PROJECT_DIR/..}
export PORT
export POLAR_RUNTIME_MANAGED=1
exec "$NODE_BIN" dist/main.js
