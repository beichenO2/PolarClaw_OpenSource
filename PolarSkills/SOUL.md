# Polarisor 生态地图

此文件是 PolarClaw Agent 的生态认知基座，描述整个 Polarisor 生态中的项目、能力、接口和文件系统约定。Agent 启动时自动加载此文件到 system prompt。

> **运行期约束**：执行任何任务前必须遵守 [Agent_core 原则](../../Agent_core/principles/CORE.md)。

## 生态全景

| 项目 | 角色 | 核心能力 | 接口方式 |
|------|------|----------|----------|
| **PolarClaw** | AI Agent 融合平台 | 多通道交互、工具调用、记忆、技能编排 | 本项目 |
| **PolarPrivate** | 隐私与身份中枢 | Secret 管理、LLM Proxy、用户身份绑定 | REST API (默认 :12790) |
| **Clock** (PolarClock) | 时间管理 PWA | 番茄钟、任务、日程、习惯追踪 | REST API + SSE |
| **AutoOffice** | 文档生成引擎 | PPT/PDF/Word/LaTeX/HTML 报告，模板管理 | officecli CLI |
| **KnowLever** | 知识管理系统 | RAG 混合检索、知识编译、Wiki 构建 | REST API |
| **digist** | 信息采集平台 | RSS 订阅、网页抓取、个性化推荐 | REST API |
| **SOTAgent** | 基础设施中枢 | 端口管理、服务发现、经验管理、Funnel | REST API (:4880) |
| **PolarCopilot** | 开发协作平台 | Hub Web UI、Agent 调度、多项目管理 | Hub API (:3850) |

## 用户体系

每个用户拥有独立的数据空间：

- **记忆隔离**：memories 表按 user_id 隔离，搜索强制过滤
- **文件隔离**：收件箱 `_feishu_inbox/{userId}/`，工作区按用户分目录
- **跨项目隔离**：调用 KnowLever、Clock 时传递 userId，各项目按用户 namespace 隔离
- **身份解析**：飞书消息通过 PolarPrivate resolveFeishuUser() 映射到 Polarisor userId

## 文件系统约定

```
~/Polarisor/
├── macbook/                    # 用户文件根目录
│   ├── Class/<科目>/           # 学习类文件（课件、实验报告）
│   ├── <项目名>/               # 科研/项目文件
│   └── _feishu_inbox/{userId}/ # 飞书收件箱（按用户隔离）
├── PolarClaw/                  # PolarClaw 项目
│   ├── skills/                 # 技能目录
│   │   ├── SOUL.md             # 生态地图（本文件）
│   │   ├── _meta/              # 元技能（思维框架）
│   │   └── <skill-name>/       # 工具技能
│   └── .data/                  # 运行时数据（SQLite 等）
├── PolarCopilot/               # 协作平台
├── KnowLever/                  # 知识系统
├── Clock/                      # 时间管理
├── SOTAgent/                   # 基础设施
├── PolarPrivate/               # 隐私中枢
└── AutoOffice/                 # 文档引擎
```

## 工具链寻路

遇到具体任务时，按以下顺序寻找工具：

1. **本地技能** → `skill_search(query, 'local')` 搜索已有技能
2. **生态技能** → `skill_search(query, 'ecosystem')` 搜索其他项目技能
3. **CLI 工具** → 搜索系统可用的 CLI 工具（MATLAB、ffmpeg、pandoc 等）
4. **自主开发** → `learning_generate_skill` 创建新技能

工具链缺口应对：
- 优先搜索 CLI 方案（WebSearch）
- 找到可用 CLI 则通过 Shell 直接调用
- 无 CLI 方案时考虑 SDK/API 集成或上报用户
