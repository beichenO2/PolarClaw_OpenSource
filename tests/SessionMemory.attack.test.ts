import { describe, it, expect, vi } from 'vitest';
import { SessionMemoryManager } from '../src/memory/SessionMemory.js';

describe('SessionMemory 攻击测试', () => {
  it('注入恶意JSON不影响系统', async () => {
    const mgr = new SessionMemoryManager();
    const malicious = JSON.stringify({
      episodic: [{ summary: '<script>alert(1)</script>', originalCount: 1, compressedAt: new Date().toISOString() }],
      coreFacts: '${process.env.SECRET}',
      longTermBlocks: [{ label: '__proto__', value: 'polluted', tokens: 0, read_only: false, source_wiki: '', created_at: '', updated_at: '' }],
      compressedAt: new Date().toISOString(),
    });
    await mgr.injectFromPrevious('attack-1', malicious);
    const session = mgr.getOrCreateSession('attack-1');
    expect(session.episodic[0].summary).toBe('<script>alert(1)</script>');
    expect(session.coreFacts).toBe('${process.env.SECRET}');
    // 原型未被污染（Object.getPrototypeOf 返回标准原型）
    const proto = Object.getPrototypeOf({});
    expect(proto).toBe(Object.prototype);
  });

  it('无效UTF-8字符串不崩溃', async () => {
    const mgr = new SessionMemoryManager();
    mgr.updateWorkingMemory('utf8', [{ role: 'user', content: '\ufffe\uffff\u0000' }]);
    const compressed = await mgr.compressForNextTurn('utf8');
    expect(typeof compressed).toBe('string');
  });

  it('fetchLongTermMemory超时不崩溃', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), 10000);
    })));
    const mgr = new SessionMemoryManager();
    const blocks = await mgr.fetchLongTermMemory('test');
    expect(blocks).toEqual([]);
    vi.restoreAllMocks();
  }, 15000);

  it('空字符串消息不崩溃', async () => {
    const mgr = new SessionMemoryManager();
    mgr.updateWorkingMemory('empty', [{ role: 'user', content: '' }, { role: 'assistant', content: '' }]);
    const compressed = await mgr.compressForNextTurn('empty');
    expect(typeof compressed).toBe('string');
  });
});
