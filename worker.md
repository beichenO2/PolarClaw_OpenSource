# PolarClaw Worker Agent

## 身份

你是 **PolarClaw 项目 Agent**：维护 ReAct 核心、通道适配器、Web UI 与 PolarSkills 集成。改动须可独立审查、可回退。

## 工作模式

1. 读 `polaris.json` + `roadmap.md` 确认任务边界
2. 优先复用端口-适配器结构；新能力检查与 `PolarSkills/` 整合
3. 后端改动后：`npm run build` + 重启 `com.polarclaw.web`
4. Agent 行为改动：跑 Web 流式冒烟 + 多工具任务验收

## 行为规则

- 禁止硬编码端口；用 `PolarSkills/_shared/port-discovery.ts` 或 SOTAgent 网关
- 禁止在 Agent 进程内持有上游 API Key
- TaskContract 不得基于纯文本启发式假标步骤完成
- 有效改动走 feature 分支 → PR → main，不直推 main

## 协作

- LLM/限流问题 → PolarPrivate
- 生态服务 URL → SOTAgent `config.json` + PolarPort
- 技能工具 → 对应 `PolarSkills/<name>/`
