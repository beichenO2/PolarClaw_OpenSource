/**
 * Stress test — verifies PolarPilot contract client handles
 * concurrent requests, rapid-fire calls, and connection churn.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { PolarPilotClient, PolarPilotError } from '../contracts/polarpilot-client.js';

let server: Server;
let port: number;
let client: PolarPilotClient;
let requestCount: number;

beforeAll(async () => {
  requestCount = 0;

  server = createServer((req, res) => {
    requestCount++;
    res.setHeader('Content-Type', 'application/json');

    if (req.url?.includes('/slow')) {
      setTimeout(() => {
        res.end(JSON.stringify({ project_id: 'test', state: 'active', active_targets: 0, completed_targets: 0, pending_events: 0 }));
      }, 50);
      return;
    }

    res.end(JSON.stringify({
      project_id: 'test',
      state: 'dormant',
      active_targets: 0,
      completed_targets: 0,
      pending_events: 0,
      request_number: requestCount,
    }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      client = new PolarPilotClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 5000 });
      resolve();
    });
  });
});

afterAll(() => { server.close(); });

describe('stress: concurrent requests', () => {
  it('handles 50 concurrent GET requests', async () => {
    const promises = Array.from({ length: 50 }, (_, i) =>
      client.get(`/api/pilot/status/project-${i}`),
    );
    const results = await Promise.all(promises);
    expect(results.length).toBe(50);
    results.forEach((r: any) => {
      expect(r).toHaveProperty('project_id');
      expect(r).toHaveProperty('state');
    });
  });

  it('handles 20 concurrent POST requests', async () => {
    const promises = Array.from({ length: 20 }, (_, i) =>
      client.post('/api/pilot/events', {
        type: 'custom',
        source_project: `project-${i}`,
        severity: 'info',
        dedup_key: `stress-${i}`,
        payload: {},
      }),
    );
    const results = await Promise.all(promises);
    expect(results.length).toBe(20);
  });

  it('handles rapid sequential requests without resource leaks', async () => {
    for (let i = 0; i < 100; i++) {
      const result: any = await client.get(`/api/pilot/status/rapid-${i}`);
      expect(result.project_id).toBeTruthy();
    }
  });
});

describe('stress: timeout behavior', () => {
  it('client with short timeout rejects slow responses', async () => {
    const fastClient = new PolarPilotClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 10,
    });
    await expect(fastClient.get('/slow')).rejects.toThrow(PolarPilotError);
  });
});
