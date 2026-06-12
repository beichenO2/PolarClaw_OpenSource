---
name: knowlever-integration
description: 与 KnowLever 知识编译引擎集成 — RAG 检索、Topic 管理、代码库摄入、LLM 编译
version: 2.0.0
requires:
  knowlever-dir: "~/Polarisor/KnowLever"
---

# KnowLever Integration

## 能力

- RAG 混合检索（BM25 + 向量）：从知识库中检索与问题相关的上下文
- Topic 列表查询：了解知识库中有哪些主题
- 知识摄入：将新文档写入知识库索引
- 代码库摄入：将开源项目/代码库整体摄入为结构化知识文档
- LLM 知识编译：将摄入的原始内容编译为互链的 wiki 页面
- 静态站构建：将 wiki 编译为可浏览的 HTML 站点

## 工具列表

- `knowlever_query`: RAG 检索 — 根据查询返回知识库中的相关上下文
- `knowlever_list_topics`: 列出知识库中所有可用的 Topic
- `knowlever_ingest`: 将文本摄入知识库（建立索引）
- `knowlever_ingest_codebase`: 将代码库（本地目录或 Git URL）摄入为 Topic
- `knowlever_compile`: 对 Topic 运行 LLM 知识编译（生成结构化 wiki）
- `knowlever_build`: 构建 Topic 的静态 HTML 站点

## 调用时机

- 用户问专业问题、需要背景知识 → `knowlever_query`
- 用户问"知识库里有什么" → `knowlever_list_topics`
- 用户要求保存知识/笔记到知识库 → `knowlever_ingest`
- 用户想分析某个开源项目/代码库 → `knowlever_ingest_codebase`
- 摄入后要编译为结构化知识 → `knowlever_compile`
- 编译后要生成可浏览站点 → `knowlever_build`
- 生成报告前需要补充上下文 → `knowlever_query`（或走 autooffice_enrich）

## 代码库摄入流程

典型流程（三步走）：
1. `knowlever_ingest_codebase` — 摄入代码库（自动识别语言/框架/结构）
2. `knowlever_compile` — LLM 编译为架构文档 + 模块文档 + 概念文档
3. `knowlever_build` — 构建可浏览的静态站

代码库摄入会自动：
- 检测项目语言、框架、License
- 过滤 node_modules/.git/build 等无关目录
- 按优先级收录源码（入口文件优先、浅层优先）
- 生成结构化 content.md（概览 + 目录树 + 配置 + 源码）

## 与 AutoOffice 的关系

AutoOffice 的 `/api/enrich` 内部也调用 KnowLever RAG。如果只需要"增强现有文档"，
用 `autooffice_enrich` 更方便。`knowlever_query` 适合直接检索原始知识上下文。

## 依赖

KnowLever 项目需存在于 `~/Polarisor/KnowLever/`（或设置 `KNOWLEVER_DIR` 环境变量）。
- RAG 管道通过 Python 子进程调用，需要 python3 且能导入 `rag.pipeline`
- 代码库摄入/编译/构建通过 Node.js 调用 KnowLever wiki-engine
- LLM 编译需要 PolarPrivate 服务运行（127.0.0.1:12790）
