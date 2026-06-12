---
name: digist-integration
description: 与 digist 信息采集引擎集成 — 爬取触发、数据搜索、推荐、状态监控
version: 1.0.0
requires:
  digist-api: "http://127.0.0.1:3800"
---

# DiGist Integration

## 能力

- 触发爬取：调用 digist API 爬取指定平台（hackernews, arxiv, reddit, bloomberg, github 等）
- 数据搜索：搜索 digist 已爬取的内容库
- 个性化推荐：获取基于兴趣的内容推荐
- 健康状态：检查 digist 服务运行状态
- 兴趣管理：查看和管理用户兴趣领域
- KnowLever 同步：触发 digist 内容同步到 KnowLever

## 工具列表

- `digist_crawl`: 触发平台爬取（hackernews, arxiv, reddit, bloomberg, github 等）
- `digist_search`: 搜索 digist 内容库中的已爬取数据
- `digist_recommend`: 获取个性化内容推荐
- `digist_status`: 检查 digist 服务健康状态与统计
- `digist_interests`: 查看用户兴趣领域列表
- `digist_sync_to_knowlever`: 触发 digist → KnowLever 内容同步

## 调用时机

- 用户说"看看最近有什么新闻/论文" → `digist_crawl` + `digist_recommend`
- 用户搜索某个技术话题 → `digist_search`
- 用户问"推荐点什么" → `digist_recommend`
- 用户问"digist 状态如何" → `digist_status`
- 用户说"同步到知识库" → `digist_sync_to_knowlever`

## 依赖

- digist API 运行在 :3800（或通过 port-sdk 发现 service_name=digist-api）
- SOTAgent port-sdk 运行在 :4800（可选，用于端口自动发现）
