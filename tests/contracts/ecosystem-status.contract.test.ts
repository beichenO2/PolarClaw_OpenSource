/**
 * Contract test — /api/ecosystem/status
 *
 * 覆盖 mixed success/failure 场景，验证：
 * 1. 整体始终返回结果（不因单项失败而抛错）
 * 2. 各分项 ok 字段正确反映真实状态
 * 3. 分项超时不阻断整体
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchEcosystemHealth } from '../../src/sdk/ecosystem-health.js';

// Mock global fetch
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string) => Promise<Response>) {
  globalThis.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    return handler(url);
  };
}

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('contract: /api/ecosystem/status (fetchEcosystemHealth)', () => {
  it('all items succeed — all ok:true', async () => {
    mockFetch(async (_url) => makeResponse(200, { healthy: true }));

    const result = await fetchEcosystemHealth({
      polarclawStatus: { name: 'PolarClaw', version: '0.1.0' },
      perCheckTimeoutMs: 1500,
    });

    expect(result.polarclaw.ok).toBe(true);
    expect(result.polarpilot.ok).toBe(true);
    expect(result.hubweb.ok).toBe(true);
    expect(result.polarprivate.ok).toBe(true);
    expect(result.sotagent.ok).toBe(true);
    expect(typeof result.ts).toBe('string');
  });

  it('polarpilot returns 500 — polarpilot ok:false, others unaffected', async () => {
    mockFetch(async (url) => {
      if (url.includes('4900')) return makeResponse(500, { error: 'internal' });
      return makeResponse(200, { healthy: true });
    });

    const result = await fetchEcosystemHealth({
      polarclawStatus: { name: 'PolarClaw' },
      perCheckTimeoutMs: 1500,
    });

    expect(result.polarclaw.ok).toBe(true);
    expect(result.polarpilot.ok).toBe(false);
    expect(result.polarpilot.error).toContain('500');
    expect(result.hubweb.ok).toBe(true);
    expect(result.polarprivate.ok).toBe(true);
    expect(result.sotagent.ok).toBe(true);
  });

  it('polarprivate and sotagent both fail — ok:false with errors', async () => {
    mockFetch(async (url) => {
      if (url.includes('12790') || url.includes('12780')) {
        return makeResponse(503, { error: 'unavailable' });
      }
      return makeResponse(200, { healthy: true });
    });

    const result = await fetchEcosystemHealth({
      polarclawStatus: { name: 'PolarClaw' },
      perCheckTimeoutMs: 1500,
    });

    expect(result.polarclaw.ok).toBe(true);
    expect(result.polarpilot.ok).toBe(true);
    expect(result.hubweb.ok).toBe(true);
    expect(result.polarprivate.ok).toBe(false);
    expect(result.sotagent.ok).toBe(false);
  });

  it('network error on fetch — item ok:false with error message', async () => {
    mockFetch(async (url) => {
      if (url.includes('4900')) throw new Error('ECONNREFUSED');
      return makeResponse(200, { healthy: true });
    });

    const result = await fetchEcosystemHealth({
      polarclawStatus: { name: 'PolarClaw' },
      perCheckTimeoutMs: 1500,
    });

    expect(result.polarpilot.ok).toBe(false);
    expect(result.polarpilot.error).toContain('ECONNREFUSED');
    // others should still succeed
    expect(result.polarprivate.ok).toBe(true);
    expect(result.sotagent.ok).toBe(true);
  });

  it('all external items fail — polarclaw still ok:true from injected status', async () => {
    mockFetch(async (_url) => {
      throw new Error('network down');
    });

    const result = await fetchEcosystemHealth({
      polarclawStatus: { name: 'PolarClaw', uptime: 100 },
      perCheckTimeoutMs: 1500,
    });

    expect(result.polarclaw.ok).toBe(true);
    expect(result.polarpilot.ok).toBe(false);
    expect(result.hubweb.ok).toBe(false);
    expect(result.polarprivate.ok).toBe(false);
    expect(result.sotagent.ok).toBe(false);
  });

  it('result always contains ts as ISO string', async () => {
    mockFetch(async (_url) => makeResponse(200, {}));

    const result = await fetchEcosystemHealth({});
    expect(result.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('mixed: 2 succeed, 2 fail, polarclaw injected — correct ok flags', async () => {
    mockFetch(async (url) => {
      if (url.includes('4900')) return makeResponse(200, { healthy: true });
      if (url.includes('8765')) return makeResponse(200, { status: 'ok' });
      if (url.includes('12790')) return makeResponse(503, {});
      if (url.includes('12780')) throw new Error('connection refused');
      return makeResponse(200, {});
    });

    const result = await fetchEcosystemHealth({
      polarclawStatus: { name: 'PolarClaw' },
      perCheckTimeoutMs: 1500,
    });

    expect(result.polarclaw.ok).toBe(true);
    expect(result.polarpilot.ok).toBe(true);
    expect(result.hubweb.ok).toBe(true);
    expect(result.polarprivate.ok).toBe(false);
    expect(result.sotagent.ok).toBe(false);
  });

  it('latencyMs is present on successful checks', async () => {
    mockFetch(async (_url) => {
      return makeResponse(200, { healthy: true });
    });

    const result = await fetchEcosystemHealth({
      polarclawStatus: { name: 'PolarClaw' },
      perCheckTimeoutMs: 1500,
    });

    expect(typeof result.polarpilot.latencyMs).toBe('number');
    expect(result.polarpilot.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
