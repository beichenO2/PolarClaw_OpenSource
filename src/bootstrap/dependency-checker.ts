/**
 * Dependency Checker — PolarClaw bootstrap dependency detection
 *
 * Detects required services at startup, auto-starts via SOTAgent if needed,
 * and waits for them to become healthy before proceeding.
 */

interface ServiceDescriptor {
  name: string;
  serviceId: string; // SOTAgent service id
  healthUrl: string;
  port?: number;
}

interface DependencyCheckerConfig {
  services: ServiceDescriptor[];
  sotagentUrl?: string;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

const DEFAULT_SERVICES: ServiceDescriptor[] = [
  {
    name: 'PolarMemory',
    serviceId: 'polar-memory',
    healthUrl: 'http://127.0.0.1:3100/health',
    port: 3100,
  },
  {
    name: 'KnowLever RAG',
    serviceId: 'knowlever-rag',
    healthUrl: 'http://127.0.0.1:18080/api/health',
    port: 18080,
  },
  {
    name: 'PolarPilot',
    serviceId: 'polarpilot',
    healthUrl: 'http://127.0.0.1:4900/api/health',
    port: 4900,
  },
];

async function checkHealth(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return resp.ok;
  } catch {
    return false;
  }
}

async function startService(sotagentUrl: string, serviceId: string): Promise<boolean> {
  try {
    const resp = await fetch(`${sotagentUrl}/api/services/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: serviceId }),
      signal: AbortSignal.timeout(10000),
    });
    return resp.ok;
  } catch (err) {
    console.error(`[Bootstrap] Failed to start ${serviceId}:`, err);
    return false;
  }
}

async function discoverPorts(sotagentUrl: string): Promise<Record<string, number>> {
  try {
    const resp = await fetch(`${sotagentUrl}/api/ports`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return {};
    const ports = await resp.json() as Array<{ project: string; port: number }>;
    const result: Record<string, number> = {};
    for (const p of ports) {
      result[p.project.toLowerCase()] = p.port;
    }
    return result;
  } catch {
    return {};
  }
}

export class DependencyChecker {
  private readonly services: ServiceDescriptor[];
  private readonly sotagentUrl: string;
  private readonly maxWaitMs: number;
  private readonly pollIntervalMs: number;

  constructor(config: DependencyCheckerConfig = { services: DEFAULT_SERVICES }) {
    this.services = config.services;
    this.sotagentUrl = config.sotagentUrl || 'http://127.0.0.1:4800';
    this.maxWaitMs = config.maxWaitMs ?? 60000;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
  }

  async checkAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const svc of this.services) {
      const ok = await this.ensureService(svc);
      results.set(svc.name, ok);
    }
    return results;
  }

  private async ensureService(svc: ServiceDescriptor): Promise<boolean> {
    // First, check if already running
    if (await checkHealth(svc.healthUrl)) {
      console.log(`[Bootstrap] ✓ ${svc.name} (port ${svc.port}) — already running`);
      return true;
    }

    // Try to start via SOTAgent
    console.log(`[Bootstrap] ${svc.name} not running, attempting start via SOTAgent...`);
    const started = await startService(this.sotagentUrl, svc.serviceId);
    if (!started) {
      console.error(`[Bootstrap] ✗ ${svc.name} — failed to start`);
      return false;
    }

    // Poll health until ready or timeout
    const deadline = Date.now() + this.maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, this.pollIntervalMs));
      if (await checkHealth(svc.healthUrl, 2000)) {
        console.log(`[Bootstrap] ✓ ${svc.name} (port ${svc.port}) — started via SOTAgent`);
        return true;
      }
    }

    console.error(`[Bootstrap] ✗ ${svc.name} — timed out waiting for health check`);
    return false;
  }

  async discoverPorts(): Promise<Record<string, string>> {
    const ports = await discoverPorts(this.sotagentUrl);
    const result: Record<string, string> = {};
    const mapping: Record<string, string> = {
      'polarmemory': 'POLARMEMORY_URL',
      'knowlever_rag': 'KNOWLEVER_URL',
      'polarpilot': 'POLARPILOT_URL',
    };
    for (const [key, port] of Object.entries(ports)) {
      const envVar = mapping[key];
      if (envVar) {
        result[envVar] = `http://127.0.0.1:${port}`;
      }
    }
    return result;
  }
}

export function createDependencyChecker(config?: DependencyCheckerConfig): DependencyChecker {
  return new DependencyChecker(config);
}
