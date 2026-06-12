import { describe, it, expect } from 'vitest';
import { SessionMemoryManager, CompressionMode } from '../src/memory/SessionMemory.js';

describe('SessionMemory 压力测试', () => {
  it('100轮对话压缩不崩溃且输出≤20K', async () => {
    const mgr = new SessionMemoryManager({ mode: CompressionMode.STATIC_MESSAGE_BUFFER, messageBufferLimit: 20, messageBufferMin: 6 });
    const convId = 'stress-100';
    for (let turn = 0; turn < 100; turn++) {
      const msgs = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `turn${turn}-msg${i}: ${'x'.repeat(100)}`,
      }));
      mgr.updateWorkingMemory(convId, msgs);
      const compressed = await mgr.compressForNextTurn(convId);
      expect(compressed.length).toBeLessThanOrEqual(20000);
    }
  });

  it('单条超长消息(50K字符)压缩不崩溃', async () => {
    const mgr = new SessionMemoryManager();
    mgr.updateWorkingMemory('long-msg', [{ role: 'user', content: 'A'.repeat(50000) }]);
    const compressed = await mgr.compressForNextTurn('long-msg');
    expect(compressed.length).toBeLessThanOrEqual(20000);
  });

  it('并发10个会话互不干扰', async () => {
    const mgr = new SessionMemoryManager();
    const tasks = Array.from({ length: 10 }, async (_, i) => {
      const convId = `concurrent-${i}`;
      mgr.updateWorkingMemory(convId, [{ role: 'user', content: `conv${i}` }]);
      return mgr.compressForNextTurn(convId);
    });
    const results = await Promise.all(tasks);
    for (const r of results) {
      expect(r.length).toBeLessThanOrEqual(20000);
      const parsed = JSON.parse(r);
      expect(parsed.episodic.length).toBeGreaterThan(0);
    }
  });
});
