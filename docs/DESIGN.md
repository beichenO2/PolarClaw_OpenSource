# PolarClaw — Agent 操作系统

> PolarClaw 是 Polarisor 的核心 Agent 框架，提供 LLM 路由、记忆系统、技能生态、飞书通道、YOLO 引擎、CareEngine 等基础能力。所有其他项目都是它的"技能"或"子系统"。

---

## 设计哲学

- **六边形架构**: 核心逻辑永不依赖外部 SDK；Port 定义能力接口，Adapter 实现外部连接，二者彻底解耦
- **身份驱动**: Agent 行为由入口类型（feishu/cli/web/ide/api）+ 用户画像（PolarUser）共同决定，不同入口触发不同 Prompt 策略与身份解析
- **自进化**: Tool usage tracking → pattern detection → auto skill generation → promotion，工具使用模式自动检测并晋升为正式 Skill
- **主动关怀**: 不只是被动响应，通过 CareEngine + Clock SSE 桥接主动发起交互，实现"先用户之想而想"
- **技能生态**: Meta-Skills 三层架构（Meta-Skills → Tool-Skills → User-Skills），支持热加载与按需组装

---

## 功能介绍

- **生态位** = Agent 操作系统，所有其他项目都是它的"技能"或"子系统"
- **承担功能**:

| 编号 | 功能域 | 说明 |
|---|---|---|
| R1 | ReAct Agent 核心 | 多通道交互（飞书/CLI/Web/IDE/API 五入口），统一 ReAct 循环 |
| R2 | 主动关怀与调度系统 | CareEngine + Clock SSE + LLM 成本追踪，主动发起而非被动等待 |
| R3 | YOLO 自主执行模式 | 多步自主任务执行 + Hub/本地双模式对齐，用户确认后全自动运行 |
| R4 | Web 控制台与文档审阅 | Dashboard + PDF/PPT 审阅 + LLM 代理 API，可视化管控台 |
| R5 | 生态技能集成 | Skill 注册表 + AutoOffice + KnowLever + ComputerUse + PolarPilot arrow_logs |
| R6 | Meta-Skill 架构 | SOUL 生态地图 + 差异化 Prompt + 按需加载，三层技能管理 |
| R7 | PolarUser 统一身份模型 | 人类/项目龙虾身份 + 项目龙虾人格，身份决定行为边界 |
| R8 | PolarClaw SDK/API | users/events/lobsters/targets/approvals HTTP API + SDK thin package |

---

## 与其他项目的关系

- **PolarPilot 是 PolarClaw 的一个内置 Skill**：因复杂度高单拎为独立项目，但本质上是 PolarClaw 的内置能力。PolarPilot 的规划-执行循环在 PolarClaw 的 ReAct 框架内运行。
- **记忆功能由 PolarClaw 提供**：通过 PolarMemory 模块实现，PolarPilot R7 集成调用 PolarMemory 的语义检索能力。
- **知识功能由 KnowLever 提供**：作为 PolarClaw 的知识检索 Skill，通过 `KnowledgePort` 接口接入。
- **SOTAgent 提供基础设施**：端口分配、进程守护、事件总线，PolarClaw 通过 `sdk-port` 接口消费。
- **PolarPrivate 提供 LLM 代理**：密钥管理与请求代理，PolarClaw 通过 `LLMPort` 接口调用，密钥永不进入 PolarClaw 进程。

---

## 关键设计决策

### Why Port-Adapter

核心逻辑与外部依赖解耦，可独立测试。当需要替换飞书 SDK 版本或切换 LLM 提供商时，只需编写新 Adapter，核心逻辑零改动。

### Why Meta-Skills 3-layer

分层管理技能复杂度：
- **Meta-Skills** — 编排层，组合 Tool-Skills 完成复杂任务
- **Tool-Skills** — 执行层，封装单一工具的调用逻辑
- **User-Skills** — 定制层，用户自创或自动生成的个性化技能

三层之间有明确的晋升通道：User-Skill 经验证后可晋升为 Tool-Skill，Tool-Skill 经编排后可纳入 Meta-Skill。

### Why Multi-entry Architecture

不同入口（飞书/CLI/Web/IDE/API）需要不同的 Prompt 策略和身份解析：
- 飞书入口 → 对话式交互，支持群聊上下文
- CLI 入口 → 命令式交互，适合开发者快速操作
- Web 入口 → 可视化交互，Dashboard + 审阅界面
- IDE 入口 → 代码感知交互，PolarCopilot polarcop-vscode 插件调用 PolarClaw API
- API 入口 → 程序化交互，SDK/自动化调用

### Why Self-learning

工具使用模式自动检测 → 技能生成 → 晋升为正式 Skill。当 Agent 反复以相似参数调用同一组 Tool-Skills 时，系统自动检测模式并提议生成 User-Skill，经用户确认后晋升。

---

## 依赖与被依赖

### 依赖

| 依赖项 | 接口 | 说明 |
|---|---|---|
| **SOTAgent** | `sdk-port` | 端口分配、进程守护、事件总线 |
| **PolarPrivate** | `LLMPort` | LLM 代理与密钥管理 |
| **Clock** | `ClockPort` | 定时调度，SSE 桥接 CareEngine |

### 被依赖

| 被依赖项 | 说明 |
|---|---|
| **KnowLever** | 作为 PolarClaw 的知识检索 Skill 接入 |
| **digist** | 作为 PolarClaw 的内容聚合 Skill 接入 |
| **AutoOffice** | 作为 PolarClaw 的文档生成 Skill 接入 |
| **PolarPilot** | 作为 PolarClaw 的内置规划-执行 Skill 运行 |
| **PolarCopilot** | Hub Web 和 polarcop-vscode 插件通过 HTTP API 消费 PolarClaw Agent 能力 |
