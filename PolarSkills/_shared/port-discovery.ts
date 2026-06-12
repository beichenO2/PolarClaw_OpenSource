/**
 * Shared port discovery for PolarClaw skills.
 *
 * Uses SOTAgent port-sdk to discover service ports dynamically.
 * Includes CircuitBreaker for resilient external service calls.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const _require = createRequire(import.meta.url);

interface PortSDK {
  getPort(serviceName: string): Promise<number | null>;
  discoverService(serviceName: string): Promise<{
    gatewayUrl: string | null;
    directUrl: string | null;
    port: number | null;
    degraded?: boolean;
  }>;
}

let _sdk: PortSDK | null = null;

function getSDK(): PortSDK | null {
  if (_sdk) return _sdk;

  const home = process.env.HOME ?? '~';
  const candidates = [
    process.env.PORT_SDK_PATH,
    resolve(home, 'Polarisor/SOTAgent/sdk-port/index.js'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      _sdk = _require(p) as PortSDK;
      return _sdk;
    } catch { /* try next */ }
  }

  return null;
}

const SOTAGENT_BASE = process.env.SOTAGENT_URL ?? 'http://127.0.0.1:4800';

let _lastRecoveryAttempt = 0;
const RECOVERY_COOLDOWN_MS = 60_000;

async function ensureSOTAgentAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${SOTAGENT_BASE}/api/status`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    if (Date.now() - _lastRecoveryAttempt < RECOVERY_COOLDOWN_MS) return false;
    _lastRecoveryAttempt = Date.now();
    console.warn('[port-discovery] SOTAgent unreachable, attempting sotctl start...');
    try {
      const { execSync } = await import('node:child_process');
      execSync('sotctl start 2>/dev/null || ~/Polarisor/SOTAgent/bin/sotctl start', {
        timeout: 15_000, stdio: 'ignore',
      });
      await new Promise(r => setTimeout(r, 3000));
      const res = await fetch(`${SOTAGENT_BASE}/api/status`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log('[port-discovery] SOTAgent recovered via sotctl start');
        return true;
      }
    } catch { /* recovery failed, will use fallback */ }
    return false;
  }
}

const _portCache = new Map<string, { port: number; ts: number }>();
const CACHE_TTL_MS = 60_000;

// ─── Circuit Breaker ────────────────────────────────────

interface CircuitState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
}

const _circuits = new Map<string, CircuitState>();
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RESET_MS = 30_000;

export function getCircuit(serviceName: string): CircuitState {
  let circuit = _circuits.get(serviceName);
  if (!circuit) {
    circuit = { failures: 0, lastFailure: 0, state: 'closed' };
    _circuits.set(serviceName, circuit);
  }
  if (circuit.state === 'open' && Date.now() - circuit.lastFailure > CIRCUIT_RESET_MS) {
    circuit.state = 'half-open';
  }
  return circuit;
}

export function recordSuccess(serviceName: string): void {
  const circuit = getCircuit(serviceName);
  circuit.failures = 0;
  circuit.state = 'closed';
}

export function recordFailure(serviceName: string): void {
  const circuit = getCircuit(serviceName);
  circuit.failures++;
  circuit.lastFailure = Date.now();
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.state = 'open';
    console.error(`[CircuitBreaker] ${serviceName}: OPEN (${circuit.failures} failures)`);
  }
}

export function isCircuitOpen(serviceName: string): boolean {
  return getCircuit(serviceName).state === 'open';
}

/**
 * Check if a service is reachable via HTTP health probe.
 */
export async function isHealthy(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

// ─── Port Discovery ─────────────────────────────────────

export async function getServicePort(serviceName: string): Promise<number | null> {
  const cached = _portCache.get(serviceName);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.port;

  const sdk = getSDK();
  if (!sdk) {
    await ensureSOTAgentAlive();
    return null;
  }

  const port = await sdk.getPort(serviceName);
  if (port != null) {
    _portCache.set(serviceName, { port, ts: Date.now() });
  } else {
    await ensureSOTAgentAlive();
  }
  return port;
}

export function getGatewayUrl(servicePrefix: string): string {
  return `${SOTAGENT_BASE}/gw/${servicePrefix.toLowerCase()}`;
}

export async function getServiceUrl(
  serviceName: string,
  gatewayPrefix?: string,
): Promise<string> {
  if (gatewayPrefix) {
    return getGatewayUrl(gatewayPrefix);
  }
  const port = await getServicePort(serviceName);
  if (port == null) {
    throw new Error(`[port-discovery] Cannot resolve port for "${serviceName}" — SOTAgent/port-sdk unavailable`);
  }
  return `http://127.0.0.1:${port}`;
}

/**
 * Resilient service call: respects circuit breaker.
 * Returns { ok, data } or { ok: false, error, circuitOpen }.
 */
export async function resilientFetch<T>(
  serviceName: string,
  url: string,
  opts: RequestInit = {},
  timeoutMs = 10000,
): Promise<{ ok: true; data: T } | { ok: false; error: string; circuitOpen: boolean }> {
  if (isCircuitOpen(serviceName)) {
    return { ok: false, error: `Circuit open for ${serviceName}`, circuitOpen: true };
  }

  try {
    const res = await fetch(url, {
      ...opts,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      recordFailure(serviceName);
      return { ok: false, error: `HTTP ${res.status}`, circuitOpen: false };
    }
    const data = await res.json() as T;
    recordSuccess(serviceName);
    return { ok: true, data };
  } catch (err) {
    recordFailure(serviceName);
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, circuitOpen: isCircuitOpen(serviceName) };
  }
}

/** Well-known service names and their gateway prefixes */
export const SERVICES = {
  DIGIST: { name: 'digist-api', gateway: 'digist' },
  KNOWLEVER_RAG: { name: 'knowlever-rag', gateway: 'knowlever' },
  AUTOOFFICE: { name: 'autooffice', gateway: 'autooffice' },
  CLOCK: { name: 'clock-backend', gateway: 'clock' },
  POLARPRIVATE: { name: 'polarprivate-backend', gateway: 'polarprivate' },
} as const;
