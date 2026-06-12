# PolarClaw — 项目灵魂

## 定位

PolarClaw 是 Polarisor 生态的**个人 Agent 操作系统**：统一 ReAct 循环、多通道（Web/飞书/CLI/Hub/MCP）、工具与技能编排，经 PolarPrivate 调用 LLM，经 PolarMemory 持久对话。

## 生态位置

| 协作方 | 关系 |
| --- | --- |
| **PolarPrivate** | LLM 网关 + 隐私脱敏（QCSA 能力码路由） |
| **SOTAgent** | 端口发现、`/gw/*` 服务网关 |
| **PolarMemory** | 会话/摘要归档 |
| **PolarSkills/** | 生态技能（digist、ecosystem、autooffice…）按需激活 |
| **PolarCopilot Hub** | Web 多 Agent 调度（8040） |

## 接口约定

| 服务 | 端口/路径 | 说明 |
| --- | --- | --- |
| Web UI + API | `3910` / `/mc/` | launchd: `com.polarclaw.web` |
| Agent 流式 API | `POST /api/agent/chat/stream` | 支持 `settings.thinkingCapability` 等 |
| LLM | PolarPrivate `:12790/v1` | SDK 带 `X-Client-Id: polarclaw` |

## 数据边界

- 管：对话历史、TaskContract、技能激活状态、用户偏好（localStorage/Web）
- 不管：API Key 明文（PolarPrivate Vault）、跨用户记忆（由 PolarMemory 隔离）
