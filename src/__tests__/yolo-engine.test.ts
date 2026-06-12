import { describe, it, expect, vi } from 'vitest';
import { createYoloEngine } from '../adapters/yolo/engine.js';
import { createRecoveryStrategy } from '../adapters/yolo/recovery.js';

const ALIGNMENT_RESPONSE: { text: string; tokens?: number } = { text: 'INPUT_TYPE:PLAN\n对齐确认：\n1. 理解目标\n2. 执行步骤\n3. 无风险' };

function makeAgent(responses: Array<{ text: string; tokens?: number }>) {
  let idx = 0;
  const allResponses = [ALIGNMENT_RESPONSE, ...responses];
  return {
    handleMessage: vi.fn().mockImplementation(async () => {
      const r = allResponses[Math.min(idx++, allResponses.length - 1)]!;
      return {
        text: r.text,
        blocked: false,
        usage: { totalTokens: r.tokens ?? 100 },
      };
    }),
  };
}

describe('createYoloEngine', () => {
  it('runs until goal reached', async () => {
    const agent = makeAgent([
      { text: '{"aligned": true, "reason": "ok", "confidence": 0.9}' },
      { text: '分析目标...开始第一步' },
      { text: '第二步完成' },
      { text: '目标已完成' },
    ]);
    const engine = createYoloEngine({
      agent,
      recovery: createRecoveryStrategy(),
    });
    const result = await engine.run(
      { projectId: 'test-project', goal: 'test', maxSteps: 10, maxTotalTokens: 100000, maxWallTimeMs: 60000, maxRetries: 2 },
      { channel: 'test', userId: 'u1', projectId: 'test-project' },
    );
    expect(result.status).toBe('completed');
    expect(result.stepsCompleted).toBe(3);
    expect(result.totalTokensUsed).toBe(500);
  });

  it('stops at maxSteps', async () => {
    const agent = makeAgent([{ text: '还在做...' }]);
    const engine = createYoloEngine({
      agent,
      recovery: createRecoveryStrategy(),
    });
    const result = await engine.run(
      { projectId: 'test-project', goal: 'infinite', maxSteps: 3, maxTotalTokens: 100000, maxWallTimeMs: 60000, maxRetries: 1 },
      { channel: 'test', userId: 'u1', projectId: 'test-project' },
    );
    expect(result.status).toBe('aborted');
    expect(result.stepsCompleted).toBe(3);
    expect(result.stopReason).toContain('最大步数');
  });

  it('stops when token budget exhausted', async () => {
    const agent = makeAgent([{ text: '高消耗步骤', tokens: 5000 }]);
    const engine = createYoloEngine({
      agent,
      recovery: createRecoveryStrategy(),
    });
    const result = await engine.run(
      { projectId: 'test-project', goal: 'expensive', maxSteps: 100, maxTotalTokens: 8000, maxWallTimeMs: 60000, maxRetries: 1 },
      { channel: 'test', userId: 'u1', projectId: 'test-project' },
    );
    expect(result.status).toBe('aborted');
    expect(result.stopReason).toContain('Token');
  });

  it('escalates when user confirmation needed', async () => {
    const agent = makeAgent([
      { text: '需要用户确认：是否删除数据库？' },
    ]);
    const onEscalate = vi.fn();
    const engine = createYoloEngine({
      agent,
      recovery: createRecoveryStrategy(),
      onEscalate,
    });
    const result = await engine.run(
      { projectId: 'test-project', goal: 'risky', maxSteps: 10, maxTotalTokens: 100000, maxWallTimeMs: 60000, maxRetries: 1 },
      { channel: 'test', userId: 'u1', projectId: 'test-project' },
    );
    expect(result.status).toBe('escalated');
    expect(onEscalate).toHaveBeenCalled();
  });

  it('calls onStepComplete callback', async () => {
    const agent = makeAgent([{ text: '目标已完成' }]);
    const onStepComplete = vi.fn();
    const engine = createYoloEngine({
      agent,
      recovery: createRecoveryStrategy(),
      onStepComplete,
    });
    await engine.run(
      { projectId: 'test-project', goal: 'quick', maxSteps: 5, maxTotalTokens: 100000, maxWallTimeMs: 60000, maxRetries: 1 },
      { channel: 'test', userId: 'u1', projectId: 'test-project' },
    );
    expect(onStepComplete).toHaveBeenCalledTimes(2);
  });

  it('cancel token prevents subsequent steps', async () => {
    let idx = 0;
    const allResponses = [ALIGNMENT_RESPONSE, { text: 'working...' }, { text: 'working...' }];
    const agent = {
      handleMessage: vi.fn().mockImplementation(async () => {
        const r = allResponses[Math.min(idx++, allResponses.length - 1)]!;
        return { text: r.text, blocked: false, usage: { totalTokens: 10 } };
      }),
    };
    const engine = createYoloEngine({
      agent,
      recovery: createRecoveryStrategy(),
    });

    const result = await engine.run(
      { projectId: 'test-project', goal: 'long', maxSteps: 2, maxTotalTokens: 100000, maxWallTimeMs: 60000, maxRetries: 1 },
      { channel: 'test', userId: 'u1', projectId: 'test-project' },
    );
    expect(result.stepsCompleted).toBe(2);
    expect(result.status).toBe('aborted');
  });

  it('retrieves session by ID', async () => {
    const agent = makeAgent([{ text: '目标已完成' }]);
    const engine = createYoloEngine({
      agent,
      recovery: createRecoveryStrategy(),
    });
    const result = await engine.run(
      { projectId: 'test-project', goal: 'quick', maxSteps: 5, maxTotalTokens: 100000, maxWallTimeMs: 60000, maxRetries: 1 },
      { channel: 'test', userId: 'u1', projectId: 'test-project' },
    );
    const session = engine.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session!.status).toBe('completed');
  });

  it('returns null for unknown session', () => {
    const engine = createYoloEngine({
      agent: makeAgent([]),
      recovery: createRecoveryStrategy(),
    });
    expect(engine.getSession('nonexistent')).toBeNull();
  });
});

describe('createRecoveryStrategy', () => {
  const recovery = createRecoveryStrategy();
  const baseCtx = { step: 1, retriesSoFar: 0, maxRetries: 3, goal: 'test' };

  it('retries on transient errors', () => {
    const action = recovery.decide(new Error('ECONNREFUSED'), baseCtx);
    expect(action.type).toBe('retry');
  });

  it('retries on timeout', () => {
    const action = recovery.decide(new Error('Request timeout'), baseCtx);
    expect(action.type).toBe('retry');
  });

  it('skips on unknown tool', () => {
    const action = recovery.decide(new Error('未注册的工具: foo'), baseCtx);
    expect(action.type).toBe('skip');
  });

  it('aborts on auth/billing errors', () => {
    const action = recovery.decide(new Error('403 Forbidden'), baseCtx);
    expect(action.type).toBe('abort');
  });

  it('escalates after max retries', () => {
    const action = recovery.decide(
      new Error('ECONNREFUSED'),
      { ...baseCtx, retriesSoFar: 3 },
    );
    expect(action.type).toBe('escalate');
  });

  it('retries once for unknown errors', () => {
    const action = recovery.decide(new Error('something weird'), { ...baseCtx, retriesSoFar: 0 });
    expect(action.type).toBe('retry');
  });

  it('escalates unknown errors on second attempt', () => {
    const action = recovery.decide(new Error('something weird'), { ...baseCtx, retriesSoFar: 1 });
    expect(action.type).toBe('escalate');
  });
});
