# Design Integration

PolarDesign 设计系统集成 Skill。提供 `design_resolve` 和 `design_generate` 两个 Tool，
桥接 PolarDesign 的风格解析和 HTML 工件生成能力。

## Tools

- **design_resolve** — 根据风格关键词匹配设计系统，返回候选列表。
- **design_generate** — 按 Skill + 设计系统生成 HTML 工件上下文，供 Agent 使用。

## 依赖

- `@polarisor/design`（PolarDesign 本地包）
