#!/usr/bin/env bash
# PolarClaw Web 常态化入口 — launchd / 手动均可调用
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export POLARISOR_ROOT="${POLARISOR_ROOT:-$ROOT/..}"
export NODE_ENV="${NODE_ENV:-production}"

NODE="${NODE:-~/.nvm/versions/node/v20.20.2/bin/node}"
NPM="${NPM:-$(dirname "$NODE")/npm}"
export PATH="$(dirname "$NODE"):${PATH:-}"

LOG_DIR="${POLARCLAW_LOG_DIR:-$HOME/.polarclaw/logs}"
mkdir -p "$LOG_DIR"

# Chat SPA 需先 build（dist 在 .gitignore）
if [[ ! -f web/dist/index.html ]]; then
  echo "[run-web-daemon] building PolarClaw/web …" >>"$LOG_DIR/web-daemon.log"
  (cd web && "$NPM" run build) >>"$LOG_DIR/web-daemon.log" 2>&1
fi

# 主进程 TypeScript 编译
if [[ ! -f dist/main.js ]] || [[ src/adapters/web/server.ts -nt dist/main.js ]]; then
  echo "[run-web-daemon] building PolarClaw main …" >>"$LOG_DIR/web-daemon.log"
  "$NPM" run build >>"$LOG_DIR/web-daemon.log" 2>&1
fi

exec "$NODE" dist/main.js >>"$LOG_DIR/web-stdout.log" 2>>"$LOG_DIR/web-stderr.log"
