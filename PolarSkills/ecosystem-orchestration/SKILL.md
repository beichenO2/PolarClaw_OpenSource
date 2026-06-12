---
name: ecosystem-orchestration
description: 生态融合编排 — 统一 digist（信息采集）+ KnowLever（知识编译）+ PolarClaw（Agent 交互）的跨项目工作流
version: 1.0.0
requires:
  digist-api: "http://127.0.0.1:4880"
  knowlever-dir: "~/Polarisor/KnowLever"
---

# Ecosystem Orchestration

## 能力

- 生态健康检查：一次性检查 digist API + KnowLever RAG + 服务注册状态
- 信息同步：触发 digist → KnowLever 的内容同步管道
- 发现-学习流水线：爬取新信息 → 同步到知识库 → 编译为结构化知识
- 统一搜索：同时搜索 digist 原始内容 + KnowLever 知识库

## 工具列表

- `ecosystem_status`: 检查整个生态系统健康状态（digist + KnowLever + 端口注册）
- `ecosystem_sync_digest`: 将 digist 已采集的内容同步到 KnowLever 知识库
- `ecosystem_discover_and_learn`: 完整流水线 — 爬取 → 同步 → 编译知识
- `ecosystem_unified_search`: 跨系统统一搜索（digist 原始数据 + KnowLever RAG）

## 调用时机

- 用户问"系统状态如何" → `ecosystem_status`
- 用户说"同步最新内容到知识库" → `ecosystem_sync_digest`
- 用户说"去了解一下 XX 领域" → `ecosystem_discover_and_learn`
- 用户搜索信息时需要全面结果 → `ecosystem_unified_search`
- 用户问"最近有什么新东西" → 先 `ecosystem_sync_digest` 再 `ecosystem_unified_search`

## 依赖

- digist API 运行在 :4880（或通过 port-sdk 发现）
- KnowLever 存在于 ~/Polarisor/KnowLever/（或 KNOWLEVER_DIR）
- SOTAgent port-sdk 运行在 :4800（可选，用于端口发现）
