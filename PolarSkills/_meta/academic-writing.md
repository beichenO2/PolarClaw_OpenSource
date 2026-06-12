---
name: academic-writing
description: 学术文档写作的通用思维框架 — 综述论文、实验报告、研究提案、课程论文、学位论文等全覆盖
triggers: 论文, 综述, 写一篇, 撰写, 期末报告, 学术, paper, review, survey, thesis, 考核, 学术报告, 文献调研
---

# 学术文档写作元技能

## 适用场景

用户要求产出学术性文档：综述论文、实验报告、课程论文、研究提案、学位论文摘要等。不限定具体学科和格式。

## 思维框架

根据实际情况动态调整，不是固定顺序。

### 1. 需求理解

- 如果给了图片/文件 → 用 `vlm_analyze` 识别内容（考核要求、题目、模板规范等）
- 明确：主题、字数要求、格式要求（LaTeX/Word/PDF）、目标读者、评审标准
- 从 `memory_search` 检索用户背景（专业方向、课程信息），个性化内容方向
- 注意"严禁AI生成"类限制 → 必须走 `autooffice_check_quality` 去AI化管线

### 2. 知识获取

- `ecosystem_unified_search` 搜索本地知识库（KnowLever + DiGist）
- 若知识库不足 → `digist_crawl` 爬取 arxiv/hackernews 相关内容
- 若涉及全新领域 → 通过 LLM 自身知识补充框架，标注需验证的部分
- 参考文献必须真实可查，绝不编造

### 3. 结构设计

- 根据文档类型选择结构（综述：摘要→引言→正文→展望→结论→参考文献）
- 结合知识获取结果调整章节权重
- 若用户指定了侧重方向（如"偏硬件"），相应加大占比

### 4. 内容生成

- 按章节分批生成，每节控制在合理长度
- 嵌入专业术语和具体技术细节（公式、算法复杂度、具体参数等）
- 参考文献在行文中自然引用
- 语言自然，避免 AI 腔调（"首先…其次…最后"模式、过度使用连接词）

### 5. 质量管控

- `autooffice_check_quality` 检测 AI 味评分
- 若评分 < B 级 → 重写高 AI 味段落
- 检查字数是否达标、结构是否完整

### 6. 文档输出

- `autooffice_generate_paper` 或 `autooffice_generate_report`（根据格式需求选择）
- 格式选择：LaTeX-PDF（学术论文）、docx（课程作业）、PDF（通用）
- 中文文档确保字体正确（宋体/黑体/仿宋，英文用 Times New Roman）

### 7. 视觉审查

- `vlm_analyze` 对生成的 PDF 逐页审查
- 检查：排版规范、图表嵌入、公式渲染、页码连续
- 发现问题 → 修正 → 重新生成 → 再审查

## 工具寻路

| 能力 | 首选工具 | 备选 |
|------|----------|------|
| 识别考核要求图片 | `vlm_analyze` | 用户口述 |
| 检索本地知识 | `ecosystem_unified_search` | `digist_search` |
| 爬取新文献 | `digist_crawl` (arxiv) | LLM 自身知识 |
| 去AI化+质量检测 | `autooffice_check_quality` | 手动改写 |
| LaTeX 论文生成 | `autooffice_generate_paper` | `autooffice_generate_report` (latex-pdf) |
| Word 报告生成 | `autooffice_generate_report` (docx) | — |
| PDF 视觉审查 | `vlm_analyze` | 人工审查 |
| 用户背景检索 | `memory_search` | 对话上下文 |

## 输出质量标准

- 内容：专业深度足够，有具体技术细节（非泛泛而谈）
- 参考文献：每一篇真实可查，引用位置合理
- 格式：符合目标模板（科研论文/课程报告等）
- AI味：AutoOffice 质量评分 >= B 级
- 排版：VLM 视觉审查通过
