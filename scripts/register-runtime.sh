#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
MODE=${1:-prepare}

case "$MODE" in
  prepare)
    command='node dist/main.js'
    auto_start=false
    health_url=''
    ;;
  cutover)
    command='bash Start/start.sh'
    auto_start=false
    health_url=''
    ;;
  finalize)
    command='bash Start/start.sh'
    auto_start=true
    health_url='http://127.0.0.1:3910/api/status'
    ;;
  *)
    echo 'Usage: bash scripts/register-runtime.sh [prepare|cutover|finalize]' >&2
    exit 2
    ;;
esac

curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null
payload=$(jq -n \
  --arg work_dir "$PROJECT_DIR" \
  --arg command "$command" \
  --arg health_url "$health_url" \
  --argjson auto_start "$auto_start" \
  '{
    id: "polarclaw",
    name: "PolarClaw Agent",
    command: $command,
    work_dir: $work_dir,
    device_id: "any",
    auto_start: $auto_start,
    restart_on_failure: true,
    max_restarts: 30,
    port: 3910,
    health_check_url: (if $health_url == "" then null else $health_url end),
    start_script_dir: "-"
  }')

curl -fsS -X POST "$POLARPROCESS_URL/api/services/register" \
  -H 'Content-Type: application/json' \
  -d "$payload"
printf '\n'
