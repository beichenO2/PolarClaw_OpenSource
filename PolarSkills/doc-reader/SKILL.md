---
name: doc-reader
description: 读取 Office 文档内容（PPT/DOCX/XLSX）— 通过 officecli 提取文本、结构和幻灯片内容
version: 1.0.0
requires:
  officecli: "PATH"
---

# Document Reader

## 能力

- 提取 PPT 幻灯片文本内容（逐页）
- 提取 DOCX 段落和表格文本
- 获取文档结构概览（页数、标题、大纲）
- 输出纯文本或结构化 JSON

## 工具列表

- `doc_read`: 读取文档全部或指定部分的文本内容
- `doc_structure`: 获取文档结构概览（大纲、页数、元数据）

## 调用时机

- 需要了解 PPT 内容（实验课件、演示文稿）→ `doc_read`
- 需要阅读 DOCX 文档（实验记录、数据表）→ `doc_read`
- 先看文档结构再决定读哪些部分 → `doc_structure`

## 依赖

- officecli CLI 工具需在 PATH 中可用
