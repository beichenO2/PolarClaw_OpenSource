# PolarMemory — PolarSoul

## 设计哲学

PolarMemory 是 PolarClaw 的语义记忆子系统，负责将非结构化知识压缩为高密度 Block 并提供检索服务。

- **压缩优先**: Wiki 内容被压缩为高密度 Block（移除标题、合并为单行），最大化 token 效率
- **只读标记**: 来自已完成/高置信度 Wiki 页面的 Block 自动标记 read_only，防止误改
- **增量同步**: 仅转换新增/变更的源文件，追踪同步元数据
- **Token 估算**: tokens = value.length / 4，为 LLM 上下文窗口提供精确预算

## 功能介绍

- **生态位**: 语义记忆存储与检索，PolarClaw 的记忆子系统
- **承担功能**:
  - R1: Wiki→Block 转换与 Block 管理（Block 数据结构 7 字段、Wiki→Block 转换器解析 YAML frontmatter + Markdown、BlockManager 提供 wikiToBlock/batchConvert/rankByImportance/sync）
  - R2: Agent 消费 API（/api/blocks/search 语义搜索、/api/blocks/convert 转换、/api/blocks/sync 同步）

## 与其他项目的关系

- **下游依赖 KnowLever**: 读取 KnowLever Wiki 产物（data/users/{user}/topics/{topic}/wiki/）
- **上游服务 PolarPilot**: PolarPilot R7 通过 /api/blocks/search 获取长期记忆
- **上游服务 PolarClaw**: PolarClaw 的 context_query 参数触发 PolarMemory 长期记忆搜索

## 关键设计决策

- Why Block not raw Wiki: 原始 Wiki 内容冗余高，Block 压缩后适合 LLM 上下文窗口
- Why incremental sync: 避免全量重转换，节省计算资源
- Why read_only marking: 已验证知识的完整性保护

## 依赖与被依赖

- **依赖**: KnowLever Wiki artifacts（只读）
- **被依赖**: PolarPilot（R7 记忆集成）、PolarClaw（context_query 记忆搜索）
