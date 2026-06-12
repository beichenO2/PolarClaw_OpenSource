---
name: lab-report
description: 实验报告自动生成 — LLM 驱动内容生成 + officecli 文档构建
version: 1.0.0
requires:
  polarprivate-llm-proxy: "http://127.0.0.1:12790"
  officecli: "PATH"
---

# Lab Report Generator

## 能力

- 基于实验背景资料和模板，自动生成完整实验报告（.docx）
- LLM 逐章节生成专业内容（实验原理、目的、步骤、结论等）
- officecli 操作 Word 模板：删除旧内容、插入新内容、嵌入实验图片
- 支持内容缓存：相同实验参数不重复调用 LLM

## 工具列表

- `lab_report_generate`: 完整工作流 — 审查模板 → LLM 生成 → 构建文档 → 验证
- `lab_report_preview`: 仅运行 LLM 生成，返回各章节文本（不构建文档）
- `lab_report_health`: 检查依赖（officecli 可用性 + LLM Proxy 连通性）

## 调用时机

- 用户需要生成实验报告 → `lab_report_generate`
- 用户想预览 LLM 生成内容再决定是否构建 → `lab_report_preview`
- 排查问题 → `lab_report_health`

## 依赖

- PolarPrivate LLM Proxy（通过 PolarClaw config 中的 llm.baseUrl 自动获取）
- officecli CLI 工具（需在 PATH 中可用）
