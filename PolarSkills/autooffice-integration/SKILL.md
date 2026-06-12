---
name: autooffice-integration
description: 与 AutoOffice 报告生成引擎集成 — 报告生成、内容分析、RAG 增强、文本质量检测
version: 1.0.0
requires:
  autooffice-api: "http://127.0.0.1:3900"
---

# AutoOffice Integration

## 能力

- 从结构化数据生成专业报告（PPT / PDF / Word / LaTeX / HTML）
- 内容分析 + Mermaid 架构图自动生成 + 路由建议
- KnowLever RAG 知识增强（通过 AutoOffice 代理调用）
- 文本去 AI 味检测 + 质量评分（A-F 评级）

## 工具列表

- `autooffice_generate_report`: 生成报告（6 种格式：pptx/pdf/docx/latex/latex-pdf/html），返回 base64 编码文件
- `autooffice_batch_generate`: 批量生成多种格式（一次调用同时产出 PPT+PDF+Word 等）
- `autooffice_generate_paper`: 生成学术论文（CVPR/NeurIPS 格式，LaTeX→PDF 编译）
- `autooffice_summarize`: 分析内容 → Mermaid 图 + 路由建议（LLMWiki / KnowLever）
- `autooffice_enrich`: 通过 KnowLever RAG 增强 Markdown 内容
- `autooffice_check_quality`: 文本质量分析（去 AI 味、单调度、多样性），返回评级和建议
- `autooffice_list_templates`: 列出可用的报告模板
- `autooffice_health`: 检查 AutoOffice 服务是否在线

## 调用时机

- 用户需要生成报告/文档 → `autooffice_generate_report`
- 用户提供大段内容要整理分析 → `autooffice_summarize`
- 用户要求对内容补充知识背景 → `autooffice_enrich`
- 用户要求检查文本是否有 AI 味/质量如何 → `autooffice_check_quality`
- 报告生成前查看可用模板 → `autooffice_list_templates`

## 依赖

AutoOffice API 服务需运行在端口 3900（`node dist/cli.js serve -p 3900` 或通过 SOTAgent 托管）。
KnowLever RAG 增强功能通过 AutoOffice 内部集成自动调用，不需要 PolarClaw 单独配置。
