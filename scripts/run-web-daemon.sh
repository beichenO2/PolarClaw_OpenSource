#!/usr/bin/env bash
# PolarClaw legacy client — lifecycle authority is PolarProcess.
set -euo pipefail

POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
exec curl -fsS -X POST "$POLARPROCESS_URL/api/services/polarclaw/start"
