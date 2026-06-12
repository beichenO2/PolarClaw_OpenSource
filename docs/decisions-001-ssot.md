# ADR-001: 统一 SSOT 文档系统

## 状态
accepted

## 背景

Polarisor 生态内各项目文档格式不统一，Agent 切换项目时缺少标准化入口，
无法快速理解项目状态和工作方式。`polaris.json` 的职责边界不清。

## 方案

1. 维持现状（各项目自由格式）→ Agent 认知成本高
2. 强制 monorepo 文档集中管理 → 灵活性差
3. **每项目标准化 5+1 文件结构** → 分布式、统一接口

## 决定

采用方案 3：每个项目根目录维护 `PolarSoul.md`、`polaris.json`、
`worker.md`、`roadmap.md`、`decisions/`、`PolarSkills/` 六件套。

核心定义：
- `polaris.json`：当前状态 + 进行中工作 + 马上要做的任务（不含长远规划）
- `roadmap.md`：所有不立刻做的需求和规划
- `PolarSkills/`：独立目录（非 `.cursor/skills/`），供所有 Agent 使用

## 后果

- SOTAgent 需增加合规检查扫描逻辑
- 现有项目需逐步迁移（PolarClaw 首个试点）
- Agent 分支策略需确保文档更新与代码改动同步
