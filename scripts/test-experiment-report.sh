#!/bin/bash
# 实验报告端到端验证脚本
#
# 模拟用户通过飞书发送实验报告任务给 PolarClaw。
# 验证 Agent 能否：
# 1. 识别这是实验报告任务（匹配元技能）
# 2. 发现并加载通用能力（doc-reader, safe-shell, lab-report 等）
# 3. 正确规划工作流（不依赖预置领域专用 skill）
#
# 用法：bash scripts/test-experiment-report.sh
# 需要：PolarClaw 各项依赖可用（PolarPrivate、officecli、Python/CLI 工具链）

set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== PolarClaw 实验报告端到端验证 ==="
echo ""

# --- 1. 验证工具链可用性 ---
echo "[1/4] 验证工具链..."

check() {
  local name="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  ✅ $name"
  else
    echo "  ❌ $name (不可用，部分功能将受限)"
  fi
}

check "officecli" "officecli --version"
check "PolarPrivate" "curl -sf http://127.0.0.1:12790/health"
check "Python" "python3 --version"
check "Node.js" "node --version"

echo ""

# --- 2. 验证技能文件完整性 ---
echo "[2/4] 验证技能文件..."
SKILLS_DIR="skills"
REQUIRED_SKILLS=(
  "doc-reader"
  "vlm-local"
  "safe-shell"
  "lab-report"
  "autooffice-integration"
)
for skill in "${REQUIRED_SKILLS[@]}"; do
  if [ -f "$SKILLS_DIR/$skill/SKILL.md" ]; then
    has_tools=""
    [ -f "$SKILLS_DIR/$skill/tools.ts" ] && has_tools=" + tools.ts"
    echo "  ✅ $skill$has_tools"
  else
    echo "  ❌ $skill (SKILL.md 缺失)"
  fi
done

# 元技能
if [ -f "$SKILLS_DIR/_meta/experiment-report.md" ]; then
  echo "  ✅ _meta/experiment-report.md (元技能)"
else
  echo "  ❌ _meta/experiment-report.md (元技能缺失)"
fi

# 生态地图
if [ -f "$SKILLS_DIR/SOUL.md" ]; then
  echo "  ✅ SOUL.md (生态地图)"
else
  echo "  ❌ SOUL.md (生态地图缺失)"
fi

echo ""

# --- 3. 验证实验数据 ---
echo "[3/4] 验证实验数据..."
DATA_BASE="$HOME/Polarisor/macbook/Class/雷达实验"
PPT="$DATA_BASE/雷达测距和距离分辨率/2、雷达测距和距离分辨率.pptx"
TEMPLATE="$DATA_BASE/实验报告模板.docx"
DATA_DIR="$DATA_BASE/第4组采集实验数据/Distance"
RECORD="$DATA_BASE/第4组采集实验数据/第四组-数据采集实验参数及场景设置记录表.docx"

[ -f "$PPT" ] && echo "  ✅ 实验 PPT" || echo "  ❌ 实验 PPT"
[ -f "$TEMPLATE" ] && echo "  ✅ 报告模板 DOCX" || echo "  ❌ 报告模板 DOCX"
[ -d "$DATA_DIR" ] && echo "  ✅ 测距数据目录 ($(ls "$DATA_DIR" | wc -l | tr -d ' ') 个文件)" || echo "  ❌ 测距数据目录"
[ -f "$RECORD" ] && echo "  ✅ 数据采集记录表" || echo "  ❌ 数据采集记录表"

echo ""

# --- 4. 模拟用户输入 ---
echo "[4/4] 设计的模拟输入如下："
echo ""
cat <<'PROMPT'
───────────────────────────────────────
模拟用户消息（通过 feishu:simulate 发送）:

npm run feishu:simulate -- \
  --user admin \
  --text "帮我完成雷达测距和距离分辨率的实验报告。

实验资料在这些位置：
- PPT: ~/Polarisor/macbook/Class/雷达实验/雷达测距和距离分辨率/2、雷达测距和距离分辨率.pptx
- 数据: ~/Polarisor/macbook/Class/雷达实验/第4组采集实验数据/Distance/
- 参数记录: ~/Polarisor/macbook/Class/雷达实验/第4组采集实验数据/第四组-数据采集实验参数及场景设置记录表.docx
- 报告模板: ~/Polarisor/macbook/Class/雷达实验/实验报告模板.docx

请先了解实验内容，再处理数据，最后生成报告。"
───────────────────────────────────────
PROMPT

echo ""
echo "预期 Agent 行为（由元技能 experiment-report 引导，使用通用能力，不依赖雷达专用 skill）："
echo "  1. 匹配 experiment-report 元技能 → 获得思维框架"
echo "  2. skill_search 找到 doc-reader → skill_activate 加载"
echo "  3. doc_read 阅读 PPT → 理解实验目的和方法"
echo "  4. doc_read 阅读参数记录表 → 理解数据采集场景"
echo "  5. skill_search 找到 safe-shell → 用可用 CLI/Python/MATLAB 工具处理数据"
echo "  6. 如需要，向用户澄清不明确的信息"
echo "  7. skill_search 找到 lab-report → 生成实验报告"
echo "  8. vlm_analyze 评估报告质量 → 优化循环"
echo "  9. 完成后汇报"
echo ""
echo "=== 验证完成 ==="
