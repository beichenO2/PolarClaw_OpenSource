/**
 * Attack test — verifies PolarPilot contract client handles
 * malformed inputs, malicious payloads, and boundary conditions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { PolarPilotClient, PolarPilotError } from '../contracts/polarpilot-client.js';

let server: Server;
let port: number;
let client: PolarPilotClient;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, `http://127.0.0.1`);
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname.includes('/malformed-json')) {
      res.end('{invalid json!!!');
      return;
    }
    if (url.pathname.includes('/empty-body')) {
      res.end('');
      return;
    }
    if (url.pathname.includes('/huge-response')) {
      const huge = { data: 'x'.repeat(1_000_000) };
      res.end(JSON.stringify(huge));
      return;
    }
    if (url.pathname.includes('/html-response')) {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html><body>Error</body></html>');
      return;
    }
    if (url.pathname.includes('/hang')) {
      // Never respond — test timeout
      return;
    }

    res.end(JSON.stringify({ ok: true, path: url.pathname, params: Object.fromEntries(url.searchParams) }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port;
      client = new PolarPilotClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 2000 });
      resolve();
    });
  });
});

afterAll(() => { server.close(); });

describe('attack: malformed server responses', () => {
  it('rejects malformed JSON response', async () => {
    await expect(client.get('/malformed-json')).rejects.toThrow();
  });

  it('rejects empty response body', async () => {
    await expect(client.get('/empty-body')).rejects.toThrow();
  });

  it('handles huge response without crash', async () => {
    const result: any = await client.get('/huge-response');
    expect(result.data.length).toBe(1_000_000);
  });
});

describe('attack: path traversal and injection', () => {
  it('safely encodes path traversal attempts', async () => {
    const result: any = await client.get('/api/pilot/../../etc/passwd');
    expect(result.ok).toBe(true);
  });

  it('safely handles query injection', async () => {
    const result: any = await client.get('/api/test', {
      project: "'; DROP TABLE targets; --",
    });
    expect(result.ok).toBe(true);
    expect(result.params.project).toBe("'; DROP TABLE targets; --");
  });

  it('safely handles unicode in project IDs', async () => {
    const result: any = await client.get('/api/pilot/targets/项目名称🎯');
    expect(result.ok).toBe(true);
  });

  it('safely handles very long paths', async () => {
    const longPath = '/api/pilot/status/' + 'a'.repeat(5000);
    const result: any = await client.get(longPath);
    expect(result.ok).toBe(true);
  });
});

describe('attack: body injection', () => {
  it('safely handles oversized POST body', async () => {
    const largePayload = { data: 'x'.repeat(100_000) };
    const result: any = await client.post('/api/test', largePayload);
    expect(result.ok).toBe(true);
  });

  it('safely handles nested object depth', async () => {
    let nested: any = { value: 'leaf' };
    for (let i = 0; i < 50; i++) {
      nested = { child: nested };
    }
    const result: any = await client.post('/api/test', nested);
    expect(result.ok).toBe(true);
  });

  it('safely handles null/undefined values in body', async () => {
    const result: any = await client.post('/api/test', {
      field: null,
      other: undefined,
      empty: '',
      zero: 0,
      falsy: false,
    });
    expect(result.ok).toBe(true);
  });
});

describe('attack: timeout and hang', () => {
  it('times out on hanging connection', async () => {
    const shortClient = new PolarPilotClient({
      baseUrl: `http://127.0.0.1:${port}`,
      timeoutMs: 200,
    });
    await expect(shortClient.get('/hang')).rejects.toThrow(PolarPilotError);
  });
});
