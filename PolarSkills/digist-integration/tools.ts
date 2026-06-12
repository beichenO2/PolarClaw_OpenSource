/**
 * DiGist Integration — PolarClaw 技能工具
 *
 * 通过 SOTAgent 网关或 port-sdk 动态发现端口，调用 digist API。
 * 遵循 port-sdk-mandatory 规则，无硬编码端口。
 */

import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, SERVICES } from '../_shared/port-discovery.js';

async function getDigistBase(): Promise<string> {
  return getServiceUrl(SERVICES.DIGIST.name, SERVICES.DIGIST.gateway);
}

async function digistGet(path: string, timeoutMs = 8000): Promise<unknown> {
  const base = await getDigistBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, { signal: controller.signal });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(timer);
  }
}

async function digistPost(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<{ status: number; data: unknown }> {
  const base = await getDigistBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, data: text }; }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Tool 1: Crawl ─────────────────────────────────────────────────

export const digistCrawl: IToolHandler = {
  name: 'digist_crawl',
  description:
    '触发 digist 爬取指定平台的最新内容。' +
    '支持 hackernews, arxiv, reddit, bloomberg, github 等平台。',
  parameters: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: '平台名称（hackernews, arxiv, reddit, bloomberg, github, glass）',
      },
      query: {
        type: 'string',
        description: '搜索关键词（hackernews/bloomberg/glass 不需要 query）',
      },
    },
    required: ['platform'],
  },
  async handler(args) {
    const platform = String(args.platform ?? '').trim().toLowerCase();
    if (!platform) throw new Error('platform 不能为空');

    const payload: Record<string, unknown> = { platform };
    if (args.query) payload.query = String(args.query);

    try {
      const { status, data } = await digistPost('/api/crawl/trigger', payload, 60000);
      return { success: status < 400, platform, result: data };
    } catch (err) {
      return { success: false, platform, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 2: Search ─────────────────────────────────────────────────

export const digistSearch: IToolHandler = {
  name: 'digist_search',
  description:
    '搜索 digist 已爬取的内容库。返回匹配的文章/帖子/论文列表。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      limit: { type: 'number', description: '返回数量（默认 10，最大 50）' },
    },
    required: ['query'],
  },
  async handler(args) {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('query 不能为空');
    const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));

    try {
      const data = await digistGet(
        `/api/items/recent?limit=${limit}&q=${encodeURIComponent(query)}`,
      );
      return { success: true, query, results: data };
    } catch (err) {
      return { success: false, query, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 3: Recommend ──────────────────────────────────────────────

export const digistRecommend: IToolHandler = {
  name: 'digist_recommend',
  description:
    '获取 digist 的个性化内容推荐。基于用户兴趣和阅读历史推荐最相关的内容。',
  parameters: {
    type: 'object',
    properties: {
      platform: { type: 'string', description: '限定平台（可选）' },
      limit: { type: 'number', description: '推荐数量（默认 5）' },
    },
  },
  async handler(args) {
    const params = new URLSearchParams();
    if (args.platform) params.set('platform', String(args.platform));
    if (args.limit) params.set('limit', String(args.limit));
    const qs = params.toString() ? `?${params}` : '';

    try {
      const data = await digistGet(`/api/recommend${qs}`);
      return { success: true, recommendations: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 4: Status ─────────────────────────────────────────────────

export const digistStatus: IToolHandler = {
  name: 'digist_status',
  description:
    '检查 digist 服务的健康状态和统计信息。包括数据库连接、内容数量、调度器状态。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const result: Record<string, unknown> = {};

    try {
      result.health = await digistGet('/health?fast=1', 5000);
    } catch (err) {
      return { online: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      result.items_count = await digistGet('/api/items/count', 3000);
    } catch { /* non-critical */ }

    try {
      result.scheduler = await digistGet('/api/scheduler/status', 3000);
    } catch { /* non-critical */ }

    return { online: true, ...result };
  },
};

// ─── Tool 5: Interests ──────────────────────────────────────────────

export const digistInterests: IToolHandler = {
  name: 'digist_interests',
  description: '查看 digist 中配置的用户兴趣领域列表。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    try {
      const data = await digistGet('/api/interests');
      return { success: true, interests: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Tool 6: Sync to KnowLever ─────────────────────────────────────

export const digistSyncToKnowlever: IToolHandler = {
  name: 'digist_sync_to_knowlever',
  description:
    '触发 digist 内容同步到 KnowLever 知识库。' +
    '将已爬取的内容按兴趣领域推送到 KnowLever 的 raw/ 目录。',
  parameters: {
    type: 'object',
    properties: {
      interest: {
        type: 'string',
        description: '指定同步的兴趣领域（不指定则同步全部）',
      },
    },
  },
  async handler(args) {
    const payload: Record<string, unknown> = {};
    if (args.interest) payload.interest = String(args.interest);

    try {
      const { status, data } = await digistPost('/api/sync-to-knowlever', payload, 60000);
      return { success: status < 400, result: data };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

// ─── Export ────────────────────────────────────────────────────────

export const digistTools: IToolHandler[] = [
  digistCrawl,
  digistSearch,
  digistRecommend,
  digistStatus,
  digistInterests,
  digistSyncToKnowlever,
];
