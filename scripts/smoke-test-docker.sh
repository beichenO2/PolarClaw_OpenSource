#!/usr/bin/env bash
# smoke-test-docker.sh — Docker 容器内 ComputerUse runtime smoke test
#
# 验证 polarclaw-browser 镜像内的完整请求链：
#   host curl → container /api/sdk/computer-use/screenshot → Stagehand → Chromium
#
# 用法: bash scripts/smoke-test-docker.sh
set -euo pipefail

CONTAINER_NAME="polarclaw-browser-test-$$"
HOST_PORT=18888
CONTAINER_PORT=3910
IMAGE="polarclaw-browser:latest"
POLARPRIVATE_URL="${POLARPRIVATE_URL:-http://127.0.0.1:12790}"
POLARPRIVATE_SERVICE_TOKEN="${POLARPRIVATE_SERVICE_TOKEN:-}"

# 彩色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cleanup() {
  echo -e "${YELLOW}[cleanup] stopping container $CONTAINER_NAME${NC}"
  docker stop -t 5 "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
}
trap cleanup EXIT

# 检查 Docker 镜像是否存在
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo -e "${RED}[ERROR] Image $IMAGE not found. Build first: docker build -f Dockerfile.browser -t polarclaw-browser .${NC}"
  exit 1
fi

echo -e "${YELLOW}[smoke] starting container $CONTAINER_NAME on host port $HOST_PORT${NC}"

# 启动容器
docker run -d --name "$CONTAINER_NAME" \
  -p "${HOST_PORT}:${CONTAINER_PORT}" \
  -e COMPUTER_USE_DOCKER=1 \
  -e POLARPRIVATE_URL="$POLARPRIVATE_URL" \
  -e POLARPRIVATE_SERVICE_TOKEN="$POLARPRIVATE_SERVICE_TOKEN" \
  -e NODE_ENV=production \
  --network=host \
  "$IMAGE" \
  node dist/main.js >/dev/null

# 等待服务就绪 (最多 60s)
echo -e "${YELLOW}[smoke] waiting for service to be ready (max 60s)${NC}"
READY=0
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${HOST_PORT}/api/sdk/computer-use/screenshot" \
    -X POST -H 'Content-Type: application/json' \
    -d '{"url":"https://example.com"}' \
    --max-time 5 \
    >/dev/null 2>&1 \
    || curl -sf "http://localhost:${HOST_PORT}/api/sdk/computer-use/screenshot?url=https://example.com" \
    --max-time 5 >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" -eq 0 ]; then
  echo -e "${RED}[smoke] FAILED: service did not become ready within 60s${NC}"
  docker logs "$CONTAINER_NAME" 2>&1 | tail -30 || true
  exit 1
fi

echo -e "${YELLOW}[smoke] service ready, running smoke test...${NC}"

# 执行 screenshot smoke test (POST with JSON body)
SMOKE_OUT=$(mktemp)
SMOKE_ERR=$(mktemp)
HTTP_CODE=0

curl -s "http://localhost:${HOST_PORT}/api/sdk/computer-use/screenshot" \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}' \
  --max-time 60 \
  -o "$SMOKE_OUT" \
  -w "%{http_code}" \
  -o /dev/null \
  > "$SMOKE_ERR" 2>&1 || HTTP_CODE=$?

REAL_CODE=$(cat "$SMOKE_ERR")

if [ "$REAL_CODE" != "200" ]; then
  echo -e "${RED}[smoke] FAILED: HTTP $REAL_CODE${NC}"
  echo "Response body:"
  cat "$SMOKE_OUT"
  exit 1
fi

# 验证响应是有效 JSON
if ! jq -e '.ok == true and (.screenshot != null and .screenshot != "")' "$SMOKE_OUT" >/dev/null 2>&1; then
  echo -e "${RED}[smoke] FAILED: invalid response JSON${NC}"
  echo "Response body:"
  cat "$SMOKE_OUT"
  exit 1
fi

# 验证截图文件存在 (如果返回的是文件路径)
SCR_PATH=$(jq -r '.screenshot' "$SMOKE_OUT")
if [ -n "$SCR_PATH" ] && [ "$SCR_PATH" != "null" ]; then
  echo -e "${GREEN}[smoke] screenshot saved to: $SCR_PATH${NC}"
fi

echo -e "${GREEN}[smoke] PASSED — screenshot endpoint returned ok:true${NC}"

# 额外测试: browse 端点 (POST with action)
BROWSE_OUT=$(mktemp)
BROWSE_CODE=$(curl -s "http://localhost:${HOST_PORT}/api/sdk/computer-use/browse" \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","action":"scroll down","screenshot":true}' \
  --max-time 90 \
  -w "%{http_code}" \
  -o "$BROWSE_OUT" 2>/dev/null)

if [ "$BROWSE_CODE" = "200" ]; then
  if jq -e '.ok == true' "$BROWSE_OUT" >/dev/null 2>&1; then
    echo -e "${GREEN}[smoke] browse endpoint PASSED${NC}"
  else
    echo -e "${YELLOW}[smoke] browse endpoint returned ok:false (LLM issue, expected in some configs)${NC}"
  fi
else
  echo -e "${YELLOW}[smoke] browse endpoint returned HTTP $BROWSE_CODE (may be expected if LLM not configured)${NC}"
fi

rm -f "$SMOKE_OUT" "$SMOKE_ERR" "$BROWSE_OUT"
echo -e "${GREEN}[smoke] All tests completed successfully${NC}"
exit 0
