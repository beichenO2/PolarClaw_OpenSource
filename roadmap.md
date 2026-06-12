# PolarClaw Roadmap

> 事实源：`polaris.json`。本文件为进度摘要。

## 最近完成（2026-06-12）

- Web：`Ctrl/⌘+Enter` 发送、流式 reasoning、右上角模型/RetryLoop 面板
- Agent：TaskContract 不再误导性 DONE/CURRENT；空响应守卫；生态 `skill_activate` fallback
- LLM：`chatStream` + 面板 capability；PolarPrivate 工具对话 reroute（配合网关）
- CI：内置 `scripts/ssot-pr-gate.sh`，修复 GitHub Actions 404
- 六件套 SSOT 文档补齐（本批）

## 技术债

| 项 | 说明 | 优先级 |
| --- | --- | --- |
| Agent 单测 | `agent.test.ts` 等部分失败为已知环境问题 | 中 |
| 飞书 Bot | `FEISHU_ADMIN_*` env 未配，管理员 Bot 未启动 | 低 |
| SOUL.md 本地脏改 | `PolarSkills/SOUL.md` 工作区有未提交改动 | 低 |

## 下一步

1. 合并后持续观察多轮 tool 对话稳定性（glm51 reroute + empty nudge）
2. 补全/稳定 Agent 契约相关单测
3. 飞书管理员 Bot 配置文档化（可选启用）
