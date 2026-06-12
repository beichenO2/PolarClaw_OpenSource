/**
 * Ecosystem Orchestration — digist + KnowLever + PolarClaw 跨项目工作流
 *
 * 通过 SOTAgent 网关/port-sdk 动态发现服务端口。
 * 遵循 port-sdk-mandatory 规则，无硬编码端口。
 */

import { execFile, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, getServicePort, SERVICES } from '../_shared/port-discovery.js';

const execFileAsync = promisify(execFile);

async function httpGet(url: string, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function httpPost(
  url: string,
  data: Record<string, unknown>,
  timeoutMs = 30000,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function getDigistBase(): Promise<string> {
  return getServiceUrl(SERVICES.DIGIST.name, SERVICES.DIGIST.gateway);
}

async function getKnowLeverRagBase(): Promise<string> {
  return getServiceUrl(SERVICES.KNOWLEVER_RAG.name, SERVICES.KNOWLEVER_RAG.gateway);
}

function getKnowLeverDir(): string {
  const env = process.env.KNOWLEVER_DIR?.trim();
  if (env) return resolve(env);
  const home = process.env.HOME ?? '~';
  return resolve(home, 'Polarisor/KnowLever');
}

function findPython(): string {
  const candidates = ['/opt/homebrew/bin/python3', 'python3'];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ['--version'], { stdio: 'pipe' });
      if (r.status === 0) return c;
    } catch { /* next */ }
  }
  return 'python3';
}

async function runPythonScript(
  script: string,
  payload: Record<string, unknown>,
  timeoutMs = 15000,
): Promise<string> {
  const klDir = getKnowLeverDir();
  const python = findPython();
  const { stdout } = await execFileAsync(
    python,
    ['-c', script, klDir, JSON.stringify(payload)],
    { timeout: timeoutMs, cwd: klDir },
  );
  return stdout.trim();
}

// ─── Tool 1: Ecosystem Status ──────────────────────────────────────

export const ecosystemStatus: IToolHandler = {
  name: 'ecosystem_status',
  description:
    '检查整个 Polarisor 生态系统的健康状态。' +
    '包括 digist（信息采集）、KnowLever RAG（知识检索）、端口注册状态。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const results: Record<string, unknown> = {};

    try {
      const digistBase = await getDigistBase();
      const { body } = await httpGet(`${digistBase}/health`, 5000);
      const health = JSON.parse(body);
      const countRes = await httpGet(`${digistBase}/api/items/count`, 3000);
      const count = JSON.parse(countRes.body);
      results.digist = {
        status: 'online',
        url: digistBase,
        health,
        items_count: count.count ?? count,
      };
    } catch (err) {
      results.digist = {
        status: 'offline',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const ragBase = await getKnowLeverRagBase();
      const { status } = await httpGet(`${ragBase}/api/health`, 3000);
      results.knowlever_rag = {
        status: status === 200 ? 'online' : 'degraded',
        url: ragBase,
      };
    } catch {
      results.knowlever_rag = { status: 'offline (HTTP)', note: 'Python subprocess fallback available' };
    }

    try {
      const klDir = getKnowLeverDir();
      const RAG_TEST = `
import sys, json
sys.path.insert(0, sys.argv[1])
from rag.pipeline import RAGPipeline
p = RAGPipeline()
print(json.dumps({"ok": True, "index_size": getattr(p, '_index_size', 'unknown')}))
`;
      const out = await runPythonScript(RAG_TEST, {}, 10000);
      results.knowlever_python = { status: 'available', dir: klDir, response: out };
    } catch (err) {
      results.knowlever_python = {
        status: 'unavailable',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const sotagentBase = process.env.SOTAGENT_URL ?? 'http://127.0.0.1:4800';
    try {
      const { body } = await httpGet(`${sotagentBase}/api/ports`, 3000);
      const ports = JSON.parse(body);
      results.port_sdk = {
        status: 'online',
        registered_services: ports.length,
        services: ports.map((p: Record<string, unknown>) => ({
          name: p.service_name,
          port: p.port,
          project: p.project,
        })),
      };
    } catch {
      results.port_sdk = { status: 'offline' };
    }

    const online = Object.values(results).filter(
      (v: unknown) => (v as Record<string, string>).status === 'online',
    ).length;
    const total = Object.keys(results).length;

    return {
      summary: `${online}/${total} services online`,
      services: results,
    };
  },
};

// ─── Tool 2: Sync Digest ───────────────────────────────────────────

export const ecosystemSyncDigest: IToolHandler = {
  name: 'ecosystem_sync_digest',
  description:
    '将 digist 已采集的内容同步到 KnowLever 知识库。' +
    '调用 digist 的 sync-to-knowlever 接口，按领域（兴趣）分类推送。',
  parameters: {
    type: 'object',
    properties: {
      interest: {
        type: 'string',
        description: '指定同步的兴趣领域（不指定则同步全部）',
      },
      days: {
        type: 'number',
        description: '同步最近 N 天的内容（默认 7）',
      },
    },
  },
  async handler(args) {
    const digistBase = await getDigistBase();
    const payload: Record<string, unknown> = {};
    if (args.interest) payload.interest = String(args.interest);
    if (args.days) payload.days = Number(args.days);

    try {
      const { status, body } = await httpPost(
        `${digistBase}/api/sync-to-knowlever`,
        payload,
        60000,
      );
      if (status >= 400) {
        return { success: false, error: body };
      }
      return { success: true, result: JSON.parse(body) };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ─── Tool 3: Discover and Learn ────────────────────────────────────

export const ecosystemDiscoverAndLearn: IToolHandler = {
  name: 'ecosystem_discover_and_learn',
  description:
    '完整的发现-学习流水线：1) 用 digist 爬取指定平台的新内容 ' +
    '2) 同步到 KnowLever 知识库 3) 可选：触发 LLM 知识编译。' +
    '一站式从信息采集到知识沉淀。',
  parameters: {
    type: 'object',
    properties: {
      platform: {
        type: 'string',
        description: '爬取平台（hackernews, arxiv, reddit, bloomberg, github）',
      },
      query: {
        type: 'string',
        description: '搜索关键词（部分平台不需要，如 hackernews）',
      },
      compile: {
        type: 'boolean',
        description: '是否在同步后触发 KnowLever 编译（默认 false，编译较慢）',
      },
      topic: {
        type: 'string',
        description: '同步到的 KnowLever Topic 名（默认按 digist 兴趣自动映射）',
      },
    },
    required: ['platform'],
  },
  async handler(args) {
    const digistBase = await getDigistBase();
    const steps: Array<{ step: string; status: string; detail?: unknown }> = [];

    const crawlPayload: Record<string, unknown> = { platform: String(args.platform) };
    if (args.query) crawlPayload.query = String(args.query);

    try {
      const { status, body } = await httpPost(
        `${digistBase}/api/crawl/trigger`,
        crawlPayload,
        60000,
      );
      const result = JSON.parse(body);
      steps.push({
        step: 'crawl',
        status: status < 400 ? 'done' : 'failed',
        detail: result,
      });
    } catch (err) {
      steps.push({
        step: 'crawl',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
      return { success: false, steps };
    }

    try {
      const syncPayload: Record<string, unknown> = {};
      if (args.topic) syncPayload.interest = String(args.topic);
      const { status, body } = await httpPost(
        `${digistBase}/api/sync-to-knowlever`,
        syncPayload,
        60000,
      );
      steps.push({
        step: 'sync_to_knowlever',
        status: status < 400 ? 'done' : 'failed',
        detail: JSON.parse(body),
      });
    } catch (err) {
      steps.push({
        step: 'sync_to_knowlever',
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    if (args.compile && args.topic) {
      try {
        const klDir = getKnowLeverDir();
        const { stdout } = await execFileAsync(
          process.execPath,
          [resolve(klDir, 'wiki-engine/compile.js'), '--topic', String(args.topic), '--user', 'admin', '--limit', '5'],
          { timeout: 300000, cwd: klDir },
        );
        steps.push({ step: 'compile', status: 'done', detail: stdout.trim() });
      } catch (err) {
        steps.push({
          step: 'compile',
          status: 'error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const allDone = steps.every(s => s.status === 'done');
    return { success: allDone, steps };
  },
};

// ─── Tool 4: Unified Search ────────────────────────────────────────

const RAG_QUERY_SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])
from rag.pipeline import RAGPipeline
pipeline = RAGPipeline()
context = pipeline.build_context(query=payload["query"], top_k=payload.get("top_k", 3))
print(context)
`;

export const ecosystemUnifiedSearch: IToolHandler = {
  name: 'ecosystem_unified_search',
  description:
    '跨系统统一搜索：同时查询 digist（原始爬取数据）和 KnowLever（结构化知识），' +
    '合并返回最相关的结果。适合需要全面信息检索的场景。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询（自然语言问题或关键词）' },
      top_k: { type: 'number', description: '每个数据源返回的最大结果数（默认 3）' },
    },
    required: ['query'],
  },
  async handler(args) {
    const query = String(args.query ?? '').trim();
    if (!query) throw new Error('query 不能为空');
    const topK = Math.min(10, Math.max(1, Number(args.top_k) || 3));

    const results: Record<string, unknown> = {};

    const digistBase = await getDigistBase();
    try {
      const { body } = await httpGet(
        `${digistBase}/api/items/recent?limit=${topK * 3}&q=${encodeURIComponent(query)}`,
        8000,
      );
      const items = JSON.parse(body);
      results.digist = {
        source: 'digist (raw items)',
        count: Array.isArray(items) ? items.length : items.items?.length ?? 0,
        items: Array.isArray(items) ? items.slice(0, topK) : (items.items ?? []).slice(0, topK),
      };
    } catch (err) {
      results.digist = {
        source: 'digist',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    try {
      const context = await runPythonScript(RAG_QUERY_SCRIPT, { query, top_k: topK }, 15000);
      results.knowlever = {
        source: 'KnowLever RAG (compiled knowledge)',
        context: context.slice(0, 3000),
      };
    } catch (err) {
      results.knowlever = {
        source: 'KnowLever RAG',
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return { query, results };
  },
};

// ─── Export ────────────────────────────────────────────────────────

export const ecosystemTools: IToolHandler[] = [
  ecosystemStatus,
  ecosystemSyncDigest,
  ecosystemDiscoverAndLearn,
  ecosystemUnifiedSearch,
];
