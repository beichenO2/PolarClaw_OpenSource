# ADR-001：Chat/Agent 运行时与多工具任务修复

**日期**：2026-06-12  
**状态**：已采纳

## 背景

Web 聊天误触发送、思考无流式细节、多工具任务空转、LLM 限流误伤等问题集中暴露。

## 决策

1. **发送键**：仅 `Ctrl/⌘+Enter` 发送；`Enter` 换行；尊重 IME `isComposing`
2. **思考展示**：PolarPrivate SSE → Agent `onProgress` → Web `ReasoningBlock` 流式累积
3. **模型面板**：思考/工具 capability 分设；RetryLoop + maxRounds 透传 `runLoop`
4. **TaskContract**：注入改为无状态 checklist，禁止无 tool 时文本启发式 `advanceStep`
5. **空响应**：无 content 且无 toolCalls 时注入续跑 system nudge
6. **skill_activate**：metaIndex 未命中时 fallback `scanEcosystemSkills`
7. **LLM 网关**：含 tool 历史的 glm51 订阅请求改路由 Qwen（PolarPrivate `tool_convo_reroute`）

## 后果

- PolarPrivate 与 PolarClaw 需同步重启方可生效
- 面板选 capability 时不再强制 OR Agentic 位，避免 1110→1111 误映射
