---
name: vlm-local
description: 本地图片/PDF 视觉分析 — 通过 vision LLM 分析本地文件中的图表、文档、截图
version: 1.0.0
requires:
  polarprivate-llm-proxy: "http://127.0.0.1:12790"
---

# VLM Local Analysis

## 能力

- 分析本地图片文件（PNG/JPG/WebP）的内容
- 评估图表质量（数据可视化、标注、美观度）
- 审查文档页面（排版、公式、格式）
- 比对图片与预期输出

## 工具列表

- `vlm_analyze`: 分析本地图片文件，返回结构化描述和评估

## 调用时机

- MATLAB 或其他工具生成图表后需要评估质量 → `vlm_analyze`
- 报告导出为 PDF 后需要逐页审查 → `vlm_analyze`
- 需要理解图片中的文字、图表、公式内容 → `vlm_analyze`

## 依赖

- PolarPrivate LLM Proxy 支持 vision 模型
- 或本地 Ollama 支持 qwen3-vl 等视觉模型
