---
name: computer-use
description: 浏览器自动化技能 — 通过 macOS Safari AppleScript 执行页面读取与表单操作，复用用户登录态；不使用 Chrome/Chromium/Playwright
version: 0.3.0
requires:
  node: ">=20"
  os: darwin
---

# ComputerUse — Safari 浏览器自动化

通过 **Safari AppleScript** 实现浏览器自动化，复用用户已在 Safari 中登录的会话。
**不使用** Chrome、Chromium、Playwright、Stagehand、bb-browser CDP。

## 工具列表

- `computer_use_browse` — 打开 URL 并返回页面文本 + 可选快照
- `computer_use_screenshot` — 抓取页面文本快照 + 可选 VLM 分析
- `computer_use_fill_form` — 按字段描述填写表单（Safari JS）

## 调用时机

- 需要读取登录后页面（飞书 wiki、内网等）→ `computer_use_screenshot`
- 需要批量填写带描述字段的表单 → `computer_use_fill_form`
- 需要打开 URL 并获取正文 → `computer_use_browse`

## 前置条件

- macOS + Safari
- Safari → 开发 → **Allow JavaScript from Apple Events**
- 目标站点已在 Safari 中登录

## 输出

- 页面正文写入 `data/screenshots/cu-*.txt`（文本快照，非 PNG）
- `page_text` / `page_title` / `page_url` 字段直接可用

## 依赖

- 无 Playwright / Stagehand 依赖
- 可选 VLM：`analyze: true` 时走 PolarPrivate / Ollama

## 沙箱外暴露

ComputerUse 通过 PolarClaw SDK（`/api/sdk/computer-use/*`）暴露，
其他项目使用 `polarclaw-project-sdk` 远程调用。

## 安全约束

- 仅在 macOS 运行；非 darwin 返回 `{ ok: false, error }`
- 快照保存到 `data/screenshots/`，文件名带时间戳
- 失败捕获为 `{ ok: false, error }`，不抛进 ReAct 循环

## 已废弃

- Dockerfile.browser / Chromium + Xvfb 容器路径
- Stagehand + Playwright headless
- bb-browser + Chrome CDP
