/**
 * conv-isolation.test — CI-safe multi-conversation parallel SSE test (mock server).
 */
import express from 'express';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';

async function streamChat(base: string, conversationId: string, message: string) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/agent/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversation_id: conversationId }),
  });
  expect(res.ok).toBe(true);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const evt = JSON.parse(line.slice(6)) as { type: string; content?: string };
      if (evt.type === 'done') content = evt.content ?? '';
    }
  }
  return { ms: Date.now() - t0, content };
}

describe('multi-conversation SSE isolation', () => {
  let server: Server;
  let base = '';
  const histories = new Map<string, string[]>();

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    app.post('/api/agent/chat/stream', async (req, res) => {
      const { message, conversation_id } = req.body as { message: string; conversation_id: string };
      const convId = conversation_id ?? 'anon';
      if (!histories.has(convId)) histories.set(convId, []);
      histories.get(convId)!.push(message);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      const delay = message.length > 10 ? 800 : 50;
      await new Promise((r) => setTimeout(r, delay));
      const content = message.length > 10 ? 'LONG_REPLY' : 'OK';
      res.write(`data: ${JSON.stringify({ type: 'done', content })}\n\n`);
      res.end();
    });

    app.get('/api/conversations/:id', (req, res) => {
      const msgs = (histories.get(req.params.id) ?? []).map((m, i) => ({
        id: `m${i}`,
        role: 'user',
        content: m,
      }));
      res.json({ conversationId: req.params.id, messages: msgs });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('short conv B finishes before long conv A (parallel)', async () => {
    const convA = `test_a_${Date.now()}`;
    const convB = `test_b_${Date.now()}`;

    const pA = streamChat(base, convA, '这是一段需要较长处理时间的请求内容');
    await new Promise((r) => setTimeout(r, 20));
    const pB = streamChat(base, convB, 'OK');

    const [rA, rB] = await Promise.all([pA, pB]);

    expect(rB.content).toBe('OK');
    expect(rA.content).toBe('LONG_REPLY');
    expect(rB.ms).toBeLessThan(rA.ms);
  });

  it('keeps separate conversation histories', async () => {
    const convA = `hist_a_${Date.now()}`;
    const convB = `hist_b_${Date.now()}`;

    await Promise.all([
      streamChat(base, convA, 'question A only'),
      streamChat(base, convB, 'B'),
    ]);

    const hA = await fetch(`${base}/api/conversations/${convA}`).then((r) => r.json()) as {
      messages: Array<{ content: string }>;
    };
    const hB = await fetch(`${base}/api/conversations/${convB}`).then((r) => r.json()) as {
      messages: Array<{ content: string }>;
    };

    expect(hA.messages.some((m) => m.content.includes('question A'))).toBe(true);
    expect(hB.messages.some((m) => m.content === 'B')).toBe(true);
    expect(hA.messages.some((m) => m.content === 'B')).toBe(false);
  });
});
