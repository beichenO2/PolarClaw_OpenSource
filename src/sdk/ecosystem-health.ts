/**
 * Ecosystem Health — 并发查询 PolarClaw 生态各分项健康状态
 *
 * 每个分项独立超时 1.5 s，单项失败不阻断整体，整体始终返回 200。
 */

export interface EcosystemHealthCheck {
  ok: boolean;
  latencyMs?: number;
  data?: unknown;
  error?: string;
}

export interface EcosystemHealth {
  polarclaw: EcosystemHealthCheck;
  polarpilot: EcosystemHealthCheck;
  hubweb: EcosystemHealthCheck;
  polarprivate: EcosystemHealthCheck;
  sotagent: EcosystemHealthCheck;
  ts: string;
}

export interface FetchEcosystemHealthOptions {
  hubUrl?: string;
  polarpilotUrl?: string;
  polarprivateUrl?: string;
  sotagentUrl?: string;
  hubAgentId?: string | null;
  /** PolarClaw 自身状态（由 server.ts 注入） */
  polarclawStatus?: unknown;
  perCheckTimeoutMs?: number;
}

async function checkUrl(url: string, timeoutMs: number): Promise<EcosystemHealthCheck> {
  const start = Date.now();
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;
    if (!resp.ok) {
      return { ok: false, latencyMs, error: `HTTP ${resp.status}` };
    }
    let data: unknown;
    try {
      data = await resp.json();
    } catch {
      data = await resp.text();
    }
    return { ok: true, latencyMs, data };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs, error: errMsg };
  }
}

export async function fetchEcosystemHealth(
  opts: FetchEcosystemHealthOptions = {},
): Promise<EcosystemHealth> {
  const {
    hubUrl = process.env.HUB_WEB_URL?.trim() || 'http://127.0.0.1:8040',
    polarpilotUrl = process.env.POLARPILOT_URL?.trim() || 'http://127.0.0.1:4900',
    polarprivateUrl = process.env.POLARPRIVATE_URL?.trim() || 'http://127.0.0.1:12790',
    sotagentUrl = process.env.SOTAGENT_URL?.trim() || 'http://127.0.0.1:4800',
    hubAgentId,
    polarclawStatus,
    perCheckTimeoutMs = 1500,
  } = opts;

  // PolarClaw 自身直接从注入状态读取，不走网络
  const polarclawCheck: EcosystemHealthCheck = polarclawStatus !== undefined
    ? { ok: true, data: polarclawStatus }
    : { ok: true, data: { note: 'status not injected' } };

  // Hub Web 分项：若有 agentId 查 agent status 端点，否则查根路径
  const hubWebUrl = hubAgentId
    ? `${hubUrl}/api/agents/${hubAgentId}/status`
    : `${hubUrl}/health`;

  const [pilotCheck, hubWebCheck, privateCheck, sotCheck] = await Promise.all([
    checkUrl(`${polarpilotUrl}/api/pilot/health`, perCheckTimeoutMs),
    checkUrl(hubWebUrl, perCheckTimeoutMs),
    checkUrl(`${polarprivateUrl}/health`, perCheckTimeoutMs),
    checkUrl(`${sotagentUrl}/health`, perCheckTimeoutMs),
  ]);

  return {
    polarclaw: polarclawCheck,
    polarpilot: pilotCheck,
    hubweb: hubWebCheck,
    polarprivate: privateCheck,
    sotagent: sotCheck,
    ts: new Date().toISOString(),
  };
}
