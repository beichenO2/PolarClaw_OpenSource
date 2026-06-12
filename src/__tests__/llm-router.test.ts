import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createLLMRouter } from '../adapters/llm/llm-router.js';
import http from 'node:http';

let mockServer: http.Server;
let serverPort: number;
let requestCount = 0;

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    requestCount++;
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const data = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: `Response to: ${data.model}`, tool_calls: [] } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: data.model,
      }));
    });
  });
  await new Promise<void>((resolve) => {
    mockServer.listen(12790, '127.0.0.1', () => {
      const addr = mockServer.address() as { port: number };
      serverPort = addr.port;
      resolve();
    });
  });
});

afterAll(() => { mockServer.close(); });

describe('createLLMRouter', () => {
  it('routes coding intent to QCSA 0001 (agent)', async () => {
    const router = createLLMRouter({});

    const result = await router.chat([
      { role: 'user', content: '帮我写一个函数' },
    ]);
    expect(result.content).toContain('0001');
    expect(result.usage?.totalTokens).toBe(15);
  });

  it('routes general intent to QCSA 0000 (balanced)', async () => {
    const router = createLLMRouter({});

    const result = await router.chat([
      { role: 'user', content: '你好，今天天气怎么样？' },
    ]);
    expect(result.content).toContain('0000');
  });

  it('resolveModel returns correct 4-bit QCSA code and intent', () => {
    const router = createLLMRouter({});

    const coding = router.resolveModel([{ role: 'user', content: '写代码实现排序' }]);
    expect(coding.intent).toBe('coding');
    expect(coding.model).toBe('capability:0001');

    const research = router.resolveModel([{ role: 'user', content: '研究一下这篇论文' }]);
    expect(research.intent).toBe('research');
    expect(research.model).toBe('capability:0100');
  });

  // ── R2: LLM 调用成本记录 ──────────────────────────────

  it('returns usage with token counts for cost tracking', async () => {
    const router = createLLMRouter({});

    const result = await router.chat([
      { role: 'user', content: '你好' },
    ]);
    expect(result.usage).toBeDefined();
    expect(result.usage!.promptTokens).toBe(10);
    expect(result.usage!.completionTokens).toBe(5);
    expect(result.usage!.totalTokens).toBe(15);
  });

  it('returns latencyMs for performance tracking', async () => {
    const router = createLLMRouter({});

    const result = await router.chat([
      { role: 'user', content: '你好' },
    ]);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns QCSA code in response for cost attribution', async () => {
    const router = createLLMRouter({});

    const result = await router.chat([
      { role: 'user', content: '帮我写代码' },
    ]);
    expect(result.model).toBe('0001');
  });
});
