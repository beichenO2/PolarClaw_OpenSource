/**
 * SessionMemory 多轮对话记忆传递测试
 *
 * 验证目标：
 * - compressForNextTurn 输出 ≤ 20K 字符
 * - injectFromPrevious 能正确恢复记忆
 * - fetchLongTermMemory 优雅降级
 * - 多轮对话记忆传递成功率 > 90%
 * - STATIC_MESSAGE_BUFFER 和 PARTIAL_EVICT 两种模式
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SessionMemoryManager,
  CompressionMode,
  type Block,
  type CompressedMemory,
} from '../src/memory/SessionMemory.js';

// ─── Mock 数据 ───

function makeMessages(count: number, prefix = 'msg'): Array<{ role: 'user' | 'assistant'; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `${prefix}-${i}: 这是第 ${i} 条消息，包含一些测试内容用于验证压缩功能。`,
  }));
}

function makeLongMessages(count: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `${'长内容'.repeat(200)} [消息${i}]`,
  }));
}

const mockBlocks: Block[] = [
  {
    label: '用户偏好',
    value: '用户喜欢简洁的回答，偏好中文',
    tokens: 15,
    read_only: false,
    source_wiki: 'test',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    label: '项目背景',
    value: 'Polarisor 是一个 AI Agent 框架项目',
    tokens: 20,
    read_only: false,
    source_wiki: 'test',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

// ─── 测试 ───

describe('SessionMemoryManager', () => {
  let manager: SessionMemoryManager;

  beforeEach(() => {
    manager = new SessionMemoryManager({
      mode: CompressionMode.STATIC_MESSAGE_BUFFER,
      messageBufferLimit: 20,
      messageBufferMin: 6,
    });
  });

  describe('基础功能', () => {
    it('应能创建和获取会话', () => {
      const session = manager.getOrCreateSession('test-conv-1');
      expect(session).toBeDefined();
      expect(session.working).toEqual([]);
      expect(session.episodic).toEqual([]);
      expect(session.coreFacts).toBe('');
      expect(session.longTermBlocks).toEqual([]);
    });

    it('同一 convId 应返回同一会话', () => {
      const s1 = manager.getOrCreateSession('conv-1');
      const s2 = manager.getOrCreateSession('conv-1');
      expect(s1).toBe(s2);
    });

    it('应能更新 working memory', () => {
      const msgs = makeMessages(5);
      manager.updateWorkingMemory('conv-1', msgs);
      const session = manager.getOrCreateSession('conv-1');
      expect(session.working).toEqual(msgs);
    });

    it('应能更新 coreFacts', () => {
      manager.updateCoreFacts('conv-1', '用户是开发者');
      const session = manager.getOrCreateSession('conv-1');
      expect(session.coreFacts).toBe('用户是开发者');
    });

    it('应能清除会话', () => {
      manager.updateWorkingMemory('conv-1', makeMessages(3));
      manager.clearSession('conv-1');
      const session = manager.getOrCreateSession('conv-1');
      expect(session.working).toEqual([]);
    });
  });

  describe('compressForNextTurn — STATIC_MESSAGE_BUFFER', () => {
    it('少量消息时应直接格式化', async () => {
      const msgs = makeMessages(5);
      manager.updateWorkingMemory('conv-1', msgs);
      const compressed = await manager.compressForNextTurn('conv-1');
      expect(compressed.length).toBeGreaterThan(0);
      const parsed = JSON.parse(compressed);
      expect(parsed.episodic).toHaveLength(1);
      expect(parsed.episodic[0].originalCount).toBe(5);
    });

    it('超过 buffer 限制时应压缩并保留最近消息', async () => {
      const msgs = makeMessages(30);
      manager.updateWorkingMemory('conv-1', msgs);
      await manager.compressForNextTurn('conv-1');
      const session = manager.getOrCreateSession('conv-1');
      // 保留最近 messageBufferMin=6 条
      expect(session.working.length).toBeLessThanOrEqual(6);
    });

    it('压缩输出应 ≤ 20K 字符', async () => {
      const msgs = makeLongMessages(50);
      manager.updateWorkingMemory('conv-1', msgs);
      const compressed = await manager.compressForNextTurn('conv-1');
      expect(compressed.length).toBeLessThanOrEqual(20000);
    });

    it('空会话压缩应返回有效 JSON', async () => {
      const compressed = await manager.compressForNextTurn('empty-conv');
      const parsed = JSON.parse(compressed);
      expect(parsed.episodic).toEqual([]);
    });
  });

  describe('compressForNextTurn — PARTIAL_EVICT_MESSAGE_BUFFER', () => {
    let evictManager: SessionMemoryManager;

    beforeEach(() => {
      evictManager = new SessionMemoryManager({
        mode: CompressionMode.PARTIAL_EVICT_MESSAGE_BUFFER,
        partialEvictPercentage: 0.3,
      });
    });

    it('应按百分比驱逐消息', async () => {
      const msgs = makeMessages(20);
      evictManager.updateWorkingMemory('conv-1', msgs);
      await evictManager.compressForNextTurn('conv-1');
      const session = evictManager.getOrCreateSession('conv-1');
      // 保留 70% = 14 条
      expect(session.working.length).toBeGreaterThanOrEqual(14);
      expect(session.working.length).toBeLessThan(20);
    });

    it('压缩输出应 ≤ 20K 字符', async () => {
      const msgs = makeLongMessages(30);
      evictManager.updateWorkingMemory('conv-1', msgs);
      const compressed = await manager.compressForNextTurn('conv-1');
      expect(compressed.length).toBeLessThanOrEqual(20000);
    });

    it('少量消息时不应驱逐', async () => {
      const msgs = makeMessages(2);
      evictManager.updateWorkingMemory('conv-1', msgs);
      await evictManager.compressForNextTurn('conv-1');
      const session = evictManager.getOrCreateSession('conv-1');
      expect(session.working.length).toBe(2);
    });
  });

  describe('injectFromPrevious', () => {
    it('应能注入压缩结果', async () => {
      const msgs = makeMessages(10);
      manager.updateWorkingMemory('conv-1', msgs);
      manager.updateCoreFacts('conv-1', '核心事实');
      const compressed = await manager.compressForNextTurn('conv-1');

      // 新 manager 模拟新进程
      const newManager = new SessionMemoryManager();
      await newManager.injectFromPrevious('conv-1', compressed);
      const session = newManager.getOrCreateSession('conv-1');
      expect(session.episodic.length).toBeGreaterThan(0);
      expect(session.coreFacts).toBe('核心事实');
    });

    it('无效 JSON 应静默忽略', async () => {
      const newManager = new SessionMemoryManager();
      await expect(newManager.injectFromPrevious('conv-1', 'invalid json')).resolves.toBeUndefined();
      const session = newManager.getOrCreateSession('conv-1');
      expect(session.episodic).toEqual([]);
    });
  });

  describe('fetchLongTermMemory', () => {
    it('API 可用时应返回 Block 数组', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ blocks: mockBlocks, total: 2 }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const mgr = new SessionMemoryManager({ polarMemoryBaseUrl: 'http://localhost:3100' });
      const blocks = await mgr.fetchLongTermMemory('用户偏好', 'test-user');
      expect(blocks).toHaveLength(2);
      expect(blocks[0].label).toBe('用户偏好');
      const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.user).toBe('test-user');

      vi.restoreAllMocks();
    });

    it('API 不可用时应优雅降级返回空数组', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

      const mgr = new SessionMemoryManager({ polarMemoryBaseUrl: 'http://localhost:3100' });
      const blocks = await mgr.fetchLongTermMemory('test', 'some-user');
      expect(blocks).toEqual([]);

      vi.restoreAllMocks();
    });

    it('API 返回非 200 时应返回空数组', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

      const mgr = new SessionMemoryManager();
      const blocks = await mgr.fetchLongTermMemory('test', 'some-user');
      expect(blocks).toEqual([]);

      vi.restoreAllMocks();
    });
  });

  describe('buildMemoryInjection', () => {
    it('应构建包含情景记忆的注入文本', async () => {
      const msgs = makeMessages(10);
      manager.updateWorkingMemory('conv-1', msgs);
      await manager.compressForNextTurn('conv-1');
      const injection = manager.buildMemoryInjection('conv-1');
      expect(injection).toContain('历史对话摘要');
    });

    it('应包含核心事实', () => {
      manager.updateCoreFacts('conv-1', '用户是 Python 开发者');
      const injection = manager.buildMemoryInjection('conv-1');
      expect(injection).toContain('核心事实');
      expect(injection).toContain('Python');
    });

    it('应包含长期记忆 Block', () => {
      const session = manager.getOrCreateSession('conv-1');
      session.longTermBlocks = mockBlocks;
      const injection = manager.buildMemoryInjection('conv-1');
      expect(injection).toContain('长期记忆');
      expect(injection).toContain('用户偏好');
    });

    it('空会话应返回空字符串', () => {
      const injection = manager.buildMemoryInjection('empty-conv');
      expect(injection).toBe('');
    });
  });

  describe('LLM 摘要集成', () => {
    it('提供 summarize 函数时应使用 LLM 生成摘要', async () => {
      const mockSummarize = vi.fn().mockResolvedValue('这是 LLM 生成的摘要');
      const mgr = new SessionMemoryManager({ summarize: mockSummarize });
      const msgs = makeMessages(25);
      mgr.updateWorkingMemory('conv-1', msgs);
      await mgr.compressForNextTurn('conv-1');
      expect(mockSummarize).toHaveBeenCalled();
      const session = mgr.getOrCreateSession('conv-1');
      expect(session.episodic[0].summary).toBe('这是 LLM 生成的摘要');
    });

    it('LLM 失败时应降级为规则压缩', async () => {
      const mockSummarize = vi.fn().mockRejectedValue(new Error('LLM error'));
      const mgr = new SessionMemoryManager({ summarize: mockSummarize });
      const msgs = makeMessages(25);
      mgr.updateWorkingMemory('conv-1', msgs);
      await mgr.compressForNextTurn('conv-1');
      const session = mgr.getOrCreateSession('conv-1');
      expect(session.episodic[0].summary.length).toBeGreaterThan(0);
    });
  });
});

// ─── 多轮对话记忆传递成功率测试 ───

describe('多轮对话记忆传递', () => {
  it('5 轮对话记忆传递成功率应 > 90%', async () => {
    const mgr = new SessionMemoryManager({
      mode: CompressionMode.STATIC_MESSAGE_BUFFER,
      messageBufferLimit: 20,
      messageBufferMin: 6,
    });

    const convId = 'multi-turn-test';
    const keyFacts = [
      '用户名字是张三',
      '用户在做 Polarisor 项目',
      '用户使用 TypeScript',
      '用户偏好简洁回答',
      '用户是后端开发者',
    ];

    let totalChecks = 0;
    let passedChecks = 0;

    // 模拟 5 轮对话
    for (let turn = 0; turn < 5; turn++) {
      const msgs = makeMessages(10, `turn${turn}`);
      // 在用户消息中嵌入关键事实
      msgs[0] = { role: 'user', content: keyFacts[turn] };
      mgr.updateWorkingMemory(convId, msgs);

      // 压缩
      const compressed = await mgr.compressForNextTurn(convId);

      // 验证压缩输出 ≤ 20K
      expect(compressed.length).toBeLessThanOrEqual(20000);

      // 模拟新进程：反序列化并检查关键事实是否保留
      const newMgr = new SessionMemoryManager();
      await newMgr.injectFromPrevious(convId, compressed);
      const injection = newMgr.buildMemoryInjection(convId);

      // 检查之前轮次的关键事实是否在注入文本中
      for (let prevTurn = 0; prevTurn <= turn; prevTurn++) {
        totalChecks++;
        if (injection.includes(keyFacts[prevTurn])) {
          passedChecks++;
        }
      }
    }

    const successRate = passedChecks / totalChecks;
    console.log(`记忆传递成功率: ${passedChecks}/${totalChecks} = ${(successRate * 100).toFixed(1)}%`);
    expect(successRate).toBeGreaterThan(0.9);
  });

  it('PARTIAL_EVICT 模式下 5 轮对话记忆传递成功率应 > 90%', async () => {
    const mgr = new SessionMemoryManager({
      mode: CompressionMode.PARTIAL_EVICT_MESSAGE_BUFFER,
      partialEvictPercentage: 0.3,
    });

    const convId = 'evict-multi-turn';
    const keyFacts = [
      '项目使用 React',
      '数据库是 PostgreSQL',
      '部署在 AWS',
      '团队有 5 人',
      '版本号 v2.0',
    ];

    let totalChecks = 0;
    let passedChecks = 0;

    for (let turn = 0; turn < 5; turn++) {
      const msgs = makeMessages(15, `turn${turn}`);
      msgs[0] = { role: 'user', content: keyFacts[turn] };
      mgr.updateWorkingMemory(convId, msgs);

      const compressed = await mgr.compressForNextTurn(convId);
      expect(compressed.length).toBeLessThanOrEqual(20000);

      const newMgr = new SessionMemoryManager({
        mode: CompressionMode.PARTIAL_EVICT_MESSAGE_BUFFER,
        partialEvictPercentage: 0.3,
      });
      await newMgr.injectFromPrevious(convId, compressed);
      const injection = newMgr.buildMemoryInjection(convId);

      for (let prevTurn = 0; prevTurn <= turn; prevTurn++) {
        totalChecks++;
        if (injection.includes(keyFacts[prevTurn])) {
          passedChecks++;
        }
      }
    }

    const successRate = passedChecks / totalChecks;
    console.log(`PARTIAL_EVICT 记忆传递成功率: ${passedChecks}/${totalChecks} = ${(successRate * 100).toFixed(1)}%`);
    expect(successRate).toBeGreaterThan(0.9);
  });
});
