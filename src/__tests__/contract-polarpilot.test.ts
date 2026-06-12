/**
 * Contract tests — verify PolarPilot API responses match defined schemas
 *
 * These tests validate that the PolarPilotClient correctly handles responses
 * from a conforming PolarPilot server and that response shapes match the
 * contract defined in contracts/polarpilot-*.schema.json.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { PolarPilotClient, PolarPilotError } from '../contracts/polarpilot-client.js';
import type {
  PilotStatusResponse,
  PilotHealthResponse,
  PilotTarget,
  PilotEmitEventResponse,
  PilotApprovalRequest,
} from '../contracts/polarpilot-query.js';

let server: Server;
let port: number;
let client: PolarPilotClient;

const MOCK_STATUS: PilotStatusResponse = {
  project_id: 'knowlever',
  state: 'active',
  current_node: 'compile-pipeline',
  last_active_at: '2026-05-03T01:00:00Z',
  active_targets: 3,
  completed_targets: 12,
  pending_events: 1,
};

const MOCK_HEALTH: PilotHealthResponse = {
  healthy: true,
  uptime_ms: 3600000,
  projects_monitored: 5,
  last_scan_at: '2026-05-03T01:00:00Z',
};

const MOCK_TARGET: PilotTarget = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  project_id: 'knowlever',
  name: 'Fix compile timeout',
  description: 'Compile pipeline times out on large topic sets',
  status: 'active',
  board: 'sprint',
  polaris_feature_ref: 'R1/wiki-compile',
  arrow_log: [
    { ts: '2026-05-03T01:00:00Z', action: 'investigation', outcome: 'identified bottleneck' },
  ],
  created_at: '2026-05-03T00:00:00Z',
  updated_at: '2026-05-03T01:00:00Z',
};

const MOCK_EMIT_RESPONSE: PilotEmitEventResponse = {
  accepted: true,
  event_id: 'evt-abc123',
  dedup_skipped: false,
};

const MOCK_APPROVAL: PilotApprovalRequest = {
  id: 'appr-xyz789',
  project_id: 'knowlever',
  requester: 'project:knowlever',
  action: 'deploy_wiki',
  description: 'Deploy updated wiki',
  status: 'pending',
  created_at: '2026-05-03T01:00:00Z',
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, `http://127.0.0.1`);
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && url.pathname.startsWith('/api/pilot/status/')) {
      res.end(JSON.stringify(MOCK_STATUS));
    } else if (req.method === 'GET' && url.pathname === '/api/pilot/status') {
      res.end(JSON.stringify([MOCK_STATUS]));
    } else if (req.method === 'GET' && url.pathname === '/api/pilot/health') {
      res.end(JSON.stringify(MOCK_HEALTH));
    } else if (req.method === 'GET' && url.pathname.match(/^\/api\/pilot\/targets\/[^/]+$/)) {
      res.end(JSON.stringify([MOCK_TARGET]));
    } else if (req.method === 'GET' && url.pathname.match(/^\/api\/pilot\/targets\/[^/]+\/[^/]+$/)) {
      res.end(JSON.stringify(MOCK_TARGET));
    } else if (req.method === 'POST' && url.pathname === '/api/pilot/events') {
      res.writeHead(201);
      res.end(JSON.stringify(MOCK_EMIT_RESPONSE));
    } else if (req.method === 'GET' && url.pathname === '/api/pilot/events') {
      res.end(JSON.stringify([]));
    } else if (req.method === 'POST' && url.pathname === '/api/pilot/approvals') {
      res.writeHead(201);
      res.end(JSON.stringify(MOCK_APPROVAL));
    } else if (req.method === 'GET' && url.pathname === '/api/pilot/approvals/pending') {
      res.end(JSON.stringify([MOCK_APPROVAL]));
    } else if (url.pathname === '/api/pilot/error-test') {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'internal_error', message: 'test error' }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not_found' }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      client = new PolarPilotClient({ baseUrl: `http://127.0.0.1:${port}` });
      resolve();
    });
  });
});

afterAll(() => { server.close(); });

// ── Status Contract ──────────────────────────────────────

describe('contract: polarpilot-status', () => {
  it('status response has required fields', async () => {
    const status = await client.get<PilotStatusResponse>('/api/pilot/status/knowlever');
    expect(status).toHaveProperty('project_id');
    expect(status).toHaveProperty('state');
    expect(status).toHaveProperty('active_targets');
    expect(status).toHaveProperty('completed_targets');
    expect(status).toHaveProperty('pending_events');
    expect(['dormant', 'active', 'error', 'unknown']).toContain(status.state);
    expect(typeof status.active_targets).toBe('number');
    expect(typeof status.completed_targets).toBe('number');
  });

  it('status list returns array', async () => {
    const statuses = await client.get<PilotStatusResponse[]>('/api/pilot/status');
    expect(Array.isArray(statuses)).toBe(true);
    if (statuses.length > 0) {
      expect(statuses[0]).toHaveProperty('project_id');
    }
  });

  it('health response has required fields', async () => {
    const health = await client.get<PilotHealthResponse>('/api/pilot/health');
    expect(typeof health.healthy).toBe('boolean');
    expect(typeof health.uptime_ms).toBe('number');
    expect(typeof health.projects_monitored).toBe('number');
  });
});

// ── Targets Contract ─────────────────────────────────────

describe('contract: polarpilot-targets', () => {
  it('target list returns array of valid targets', async () => {
    const targets = await client.get<PilotTarget[]>('/api/pilot/targets/knowlever');
    expect(Array.isArray(targets)).toBe(true);
    const t = targets[0]!;
    expect(t).toHaveProperty('id');
    expect(t).toHaveProperty('project_id');
    expect(t).toHaveProperty('name');
    expect(t).toHaveProperty('status');
    expect(t).toHaveProperty('board');
    expect(t).toHaveProperty('arrow_log');
    expect(['active', 'hit', 'moved', 'archived']).toContain(t.status);
    expect(['backlog', 'sprint', 'done', 'archived']).toContain(t.board);
    expect(Array.isArray(t.arrow_log)).toBe(true);
  });

  it('single target has complete schema', async () => {
    const t = await client.get<PilotTarget>('/api/pilot/targets/knowlever/a1b2c3d4');
    expect(t.id).toBeTruthy();
    expect(t.created_at).toBeTruthy();
    expect(t.updated_at).toBeTruthy();
    if (t.arrow_log.length > 0) {
      expect(t.arrow_log[0]).toHaveProperty('ts');
      expect(t.arrow_log[0]).toHaveProperty('action');
      expect(t.arrow_log[0]).toHaveProperty('outcome');
    }
  });
});

// ── Events Contract ──────────────────────────────────────

describe('contract: polarpilot-events', () => {
  it('emit response has required fields', async () => {
    const result = await client.post<PilotEmitEventResponse>('/api/pilot/events', {
      type: 'bug',
      source_project: 'knowlever',
      severity: 'warning',
      dedup_key: 'contract-test-1',
      payload: {},
    });
    expect(typeof result.accepted).toBe('boolean');
    expect(typeof result.event_id).toBe('string');
    expect(typeof result.dedup_skipped).toBe('boolean');
  });

  it('query returns array', async () => {
    const events = await client.get<unknown[]>('/api/pilot/events');
    expect(Array.isArray(events)).toBe(true);
  });
});

// ── Approvals Contract ───────────────────────────────────

describe('contract: polarpilot-approvals', () => {
  it('create approval returns valid schema', async () => {
    const approval = await client.post<PilotApprovalRequest>('/api/pilot/approvals', {
      project_id: 'knowlever',
      requester: 'project:knowlever',
      action: 'deploy',
    });
    expect(approval).toHaveProperty('id');
    expect(approval).toHaveProperty('status');
    expect(approval).toHaveProperty('created_at');
    expect(['pending', 'approved', 'rejected', 'expired']).toContain(approval.status);
  });

  it('pending list returns array', async () => {
    const pending = await client.get<PilotApprovalRequest[]>('/api/pilot/approvals/pending');
    expect(Array.isArray(pending)).toBe(true);
    if (pending.length > 0) {
      expect(pending[0]).toHaveProperty('id');
      expect(pending[0]).toHaveProperty('status');
    }
  });
});

// ── Error Handling ───────────────────────────────────────

describe('contract: error handling', () => {
  it('throws PolarPilotError on server error', async () => {
    await expect(
      client.get('/api/pilot/error-test'),
    ).rejects.toThrow(PolarPilotError);
  });

  it('PolarPilotError includes status code', async () => {
    try {
      await client.get('/api/pilot/error-test');
    } catch (err) {
      expect(err).toBeInstanceOf(PolarPilotError);
      expect((err as PolarPilotError).statusCode).toBe(500);
    }
  });

  it('throws on network error (unreachable port)', async () => {
    const badClient = new PolarPilotClient({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 1000 });
    await expect(
      badClient.get('/api/pilot/status'),
    ).rejects.toThrow(PolarPilotError);
  });
});
