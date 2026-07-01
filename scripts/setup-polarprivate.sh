#!/bin/bash
# PolarClaw — PolarPrivate 飞书凭证初始化脚本
#
# 前提：
#   1. PolarPrivate 后端已运行（端口 12790）
#   2. Vault 已解锁（在浏览器 http://localhost:5170 输入 Master Password）
#
# 用法：
#   bash scripts/setup-polarprivate.sh
#
# 功能：
#   - 确保 PolarClaw 项目存在
#   - 创建飞书管理员 Bot 和女友 Bot 的 Secret 占位符
#   - 创建 DashScope API Key Secret 占位符
#   - 所有 Secret 初始值为 PLACEHOLDER，需要在 PolarPrivate UI 中替换为真实值

set -euo pipefail

PP="${POLARPRIVATE_URL:-http://127.0.0.1:12790}"

log() { echo "[setup-pp] $*"; }
err() { echo "[setup-pp] ❌ $*" >&2; }

# ── 健康检查 ────────────────────────────────────────
health=$(curl -sf "$PP/health" 2>/dev/null) || {
  err "PolarPrivate 不可达 ($PP)，请先启动后端"
  exit 1
}

vault_unlocked=$(echo "$health" | python3 -c "import sys,json; print(json.load(sys.stdin).get('vault_unlocked', False))" 2>/dev/null)
if [ "$vault_unlocked" != "True" ]; then
  err "Vault 未解锁。请在浏览器打开 PolarPrivate UI 并输入 Master Password"
  err "  → http://localhost:5170"
  exit 1
fi

log "✅ PolarPrivate 已连接，Vault 已解锁"

# ── 确保 PolarClaw 项目存在 ───────────────────────────
PROJECT_ID=$(curl -sf "$PP/api/projects" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', data) if isinstance(data, dict) else data
for p in items:
    if p['name'] == 'PolarClaw':
        print(p['id'])
        break
" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
  log "创建 PolarClaw 项目..."
  PROJECT_ID=$(curl -sf -X POST "$PP/api/projects" \
    -H "Content-Type: application/json" \
    -d '{"name": "PolarClaw", "description": "AI Agent 融合平台 — 飞书通道凭证"}' | \
    python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  log "✅ 项目已创建: $PROJECT_ID"
else
  log "✅ 项目已存在: $PROJECT_ID"
fi

# ── 工具函数 ────────────────────────────────────────

create_secret() {
  local key="$1"
  local category="$2"
  local value="${3:-PLACEHOLDER}"

  existing=$(curl -sf "$PP/api/secrets?project_id=$PROJECT_ID&q=$key" | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
for s in data.get('items', []):
    if s['key'] == '$key':
        print(s['id'])
        break
" 2>/dev/null)

  if [ -n "$existing" ]; then
    log "  跳过 $key（已存在）"
    return
  fi

  result=$(curl -sf -X POST "$PP/api/secrets" \
    -H "Content-Type: application/json" \
    -d "{\"key\": \"$key\", \"value\": \"$value\", \"project_id\": \"$PROJECT_ID\", \"category\": \"$category\"}" 2>&1)

  if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'id' in d else 1)" 2>/dev/null; then
    log "  ✅ $key"
  else
    err "  创建 $key 失败: $result"
  fi
}

create_identity() {
  local key="$1"
  local value="$2"
  local category="$3"

  existing=$(curl -sf "$PP/api/identities?project_id=$PROJECT_ID&q=$key" | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
for s in data.get('items', []):
    if s['key'] == '$key':
        print(s['id'])
        break
" 2>/dev/null)

  if [ -n "$existing" ]; then
    log "  跳过 $key（已存在）"
    return
  fi

  result=$(curl -sf -X POST "$PP/api/identities" \
    -H "Content-Type: application/json" \
    -d "{\"key\": \"$key\", \"value\": \"$value\", \"project_id\": \"$PROJECT_ID\", \"category\": \"$category\"}" 2>&1)

  if echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if 'id' in d else 1)" 2>/dev/null; then
    log "  ✅ $key"
  else
    err "  创建 $key 失败: $result"
  fi
}

# ── 飞书管理员 Bot（admin）─────────────────────────
log ""
log "━━━ 飞书管理员 Bot ━━━"
create_secret "feishu.admin.app_id"              "feishu"
create_secret "feishu.admin.app_secret"           "feishu"
create_secret "feishu.admin.verification_token"   "feishu"
create_secret "feishu.admin.encrypt_key"          "feishu"

# ── 飞书 PolarClaw_Rr Bot（feishu.rr / @套辞）──────────────────
log ""
log "━━━ 飞书 PolarClaw_Rr Bot（feishu.rr）━━━"
create_secret "feishu.rr.app_id"              "feishu"
create_secret "feishu.rr.app_secret"           "feishu"
create_secret "feishu.rr.verification_token"   "feishu"
create_secret "feishu.rr.encrypt_key"          "feishu"

# ── LLM API ────────────────────────────────────────
log ""
log "━━━ LLM API ━━━"
create_secret "dashscope.api_key"  "llm"

# ── 飞书应用信息（Identity，非敏感）────────────────
log ""
log "━━━ 飞书应用信息（Identity）━━━"
create_identity "feishu.admin.app_name"       "PolarClaw 管理员 Bot"   "feishu"
create_identity "feishu.admin.webhook_path"   "/webhook/feishu/admin"  "feishu"
create_identity "feishu.rr.app_name"        "PolarClaw_Rr"           "feishu"
create_identity "feishu.rr.webhook_path"      "/webhook/feishu/rr"     "feishu"

# ── 完成 ────────────────────────────────────────────
log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "✅ PolarPrivate 飞书凭证初始化完成！"
log ""
log "⚠️  所有 Secret 当前值为 PLACEHOLDER"
log "   请在 PolarPrivate UI 中替换为真实值："
log "   → http://localhost:5170"
log ""
log "   需要填写的凭证："
log "   1. 飞书开放平台 → 管理员 Bot 的 App ID / Secret / Token / Encrypt Key"
log "   2. 飞书开放平台 → 女友 Bot 的 App ID / Secret / Token / Encrypt Key"
log "   3. 阿里云百炼 → DashScope API Key"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
