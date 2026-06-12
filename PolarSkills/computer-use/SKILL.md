---
name: computer-use
description: 浏览器自动化技能 — 通过 Stagehand（Playwright AI 层）执行自然语言驱动的浏览器操作，支持 Docker 隔离运行
version: 0.2.0
requires:
  node: ">=20"
---

# ComputerUse — 浏览器自动化技能

通过 Stagehand（Playwright 上层 AI 框架）实现浏览器自动化操作。
支持在隔离 Docker 环境中运行，不影响用户桌面。

## 工具列表

- `computer_use_browse` — 自然语言驱动的浏览器操作（导航、点击、填写）
- `computer_use_screenshot` — 页面截图 + 可选 observe（Stagehand accessibility tree）或 analyze（本地 VLM）
- `computer_use_fill_form` — 结构化表单自动填写

## 调用时机

- 需要打开网页并进行交互（点击、填写、滚动）→ `computer_use_browse`
- 需要对页面截图后 VLM 视觉分析 / UI 评分 → `computer_use_screenshot` with `analyze: true`
- 需要批量填写带描述字段的表单 → `computer_use_fill_form`

## LLM 路径

| 模式 | 用途 | LLM 端点 | 模型 |
|------|------|----------|------|
| `observe: true` | Stagehand accessibility tree 文本元素发现 | PolarPrivate proxy (`127.0.0.1:12790`) | qwen3-coder-plus |
| `analyze: true` | 截图视觉理解 / OCR | PolarPrivate 本地 L101 (`127.0.0.1:12790`) | Ollama VLM（服务端映射） |

## 依赖

- `@browserbasehq/stagehand` — AI 浏览器自动化框架
- `playwright` — 底层浏览器引擎
- Stagehand observe/act 走 PolarPrivate proxy，自动注入 DashScope key，无需外部 API key
- 本地 VLM 经 PolarPrivate L101 转发至 Ollama（需 Ollama 常驻 + PolarPrivate :12790）
- Docker（可选）— 用于桌面隔离运行

## 桌面隔离（推荐部署形态）

使用 `Dockerfile.browser` 把整个 PolarClaw 跑在容器里，
Chromium + Xvfb + Node 进程都在容器内，宿主桌面完全不受影响：

```bash
docker build -f Dockerfile.browser -t polarclaw-browser .
docker run --rm -p 3910:3910 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.env:/app/.env:ro \
  polarclaw-browser
```

容器内 `COMPUTER_USE_DOCKER=1` 自动设置，作为"我已在隔离环境中运行"的标记，
ComputerUse 工具直接走容器内 Stagehand，无需再跨容器调度。
其他项目通过 `polarclaw-project-sdk` 调用时，请求会到容器内的
`/api/sdk/computer-use/*` 路由，浏览器操作完全沙箱化。

## 沙箱外暴露

ComputerUse 同时通过 PolarClaw SDK（`/api/sdk/computer-use/*`）以"沙箱外服务"形式暴露，
其他项目可使用 `polarclaw-project-sdk` 远程调用，详见 SSOT/interfaces.md。

## 安全约束

- 默认 headless 模式，不弹窗
- 截图保存到 `data/screenshots/`，文件名带时间戳
- Stagehand 调用失败会捕获并返回 `{ ok: false, error }`，不抛进 ReAct 循环
