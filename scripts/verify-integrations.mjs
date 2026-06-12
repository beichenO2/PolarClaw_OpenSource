#!/usr/bin/env node
/**
 * Manual integration smoke: probes external services when they are up.
 * Run: node scripts/verify-integrations.mjs
 * Exit 0 always (informational); check JSON for per-service status.
 */

const TIMEOUT = 4000;

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
    const ms = Date.now() - t0;
    return { name, url, ok: res.ok, status: res.status, latencyMs: ms };
  } catch (e) {
    return { name, url, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const pp = (process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790').replace(/\/$/, '');
const polarclaw = process.env.POLARCLAW_WEB_BASE; // e.g. http://127.0.0.1:8080 由 PolarClaw web 实际端口决定

const checks = [
  ['PolarPrivate', `${pp}/health`],
  ['SOTAgent', 'http://127.0.0.1:4800/api/status'],
  ['AutoOffice', 'http://127.0.0.1:3900/health'],
];
if (polarclaw) {
  checks.push(['PolarClaw Web', `${polarclaw.replace(/\/$/, '')}/api/status`]);
}

async function main() {
  const results = [];
  for (const [name, url] of checks) {
    if (url.includes('undefined')) continue;
    results.push(await probe(name, url));
  }
  console.log(JSON.stringify({ checked_at: new Date().toISOString(), results }, null, 2));
}

main();
