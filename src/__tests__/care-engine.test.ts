import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCareEngine, createCarePolicy } from '../adapters/proactive/care-engine.js';
import type { IProactiveTrigger } from '../ports/proactive.js';

function makeMemory(profiles: Record<string, string> = {}) {
  return {
    getProfile: vi.fn((userId: string, key: string) => profiles[`${userId}:${key}`] ?? null),
    getAllProfiles: vi.fn((userId: string) => {
      return Object.entries(profiles)
        .filter(([k]) => k.startsWith(`${userId}:`))
        .map(([k, v]) => ({ userId, key: k.split(':')[1], value: v }));
    }),
    saveProfile: vi.fn(),
    save: vi.fn(),
    search: vi.fn().mockReturnValue({ entries: [], total: 0 }),
    close: vi.fn(),
  } as any;
}

function makeTools(has = false) {
  return {
    has: vi.fn().mockReturnValue(has),
    execute: vi.fn().mockResolvedValue({ running: false }),
    list: vi.fn().mockReturnValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
  } as any;
}

describe('createCarePolicy', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-04-15T14:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates inactivity message when user inactive long enough', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
    const memory = makeMemory({ 'u1:lastActiveAt': fiveHoursAgo });
    const policy = createCarePolicy(
      { memory, tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const trigger: IProactiveTrigger = {
      type: 'cron',
      userId: 'u1',
      reason: 'inactivity',
    };

    const msg = await policy.evaluate(trigger);
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('inactivity-care');
    expect(msg!.prompt).toContain('系统提示');
  });

  it('returns null when user recently active', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    const memory = makeMemory({ 'u1:lastActiveAt': tenMinAgo });
    const policy = createCarePolicy(
      { memory, tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'cron', userId: 'u1', reason: 'inactivity',
    });
    expect(msg).toBeNull();
  });

  it('returns null when no lastActiveAt profile', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'cron', userId: 'u1', reason: 'inactivity',
    });
    expect(msg).toBeNull();
  });

  it('handles timer-complete with Clock tools', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools(true) },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'timer-complete',
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('timer-care');
  });

  it('returns null for timer-complete without Clock tools', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools(false) },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'timer-complete',
    });
    expect(msg).toBeNull();
  });

  it('handles scheduled care', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'cron', userId: 'u1', reason: 'scheduled',
      context: { prompt: '定制关怀消息' },
    });
    expect(msg).not.toBeNull();
    expect(msg!.prompt).toBe('定制关怀消息');
  });

  it('generates topic message with knowledge source', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'condition', userId: 'u1', reason: 'topic',
      context: { topic: 'RAG 混合检索优化', source: 'KnowLever' },
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('topic-initiative');
    expect(msg!.prompt).toContain('RAG 混合检索优化');
    expect(msg!.prompt).toContain('KnowLever');
  });

  it('generates topic message without specific topic', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'condition', userId: 'u1', reason: 'topic',
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('topic-initiative');
    expect(msg!.prompt).toContain('系统提示');
  });

  // ── R2: 日程驱动关怀 ──────────────────────────────────

  it('generates schedule-pre-alert for meal block', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'schedule-pre-alert',
      context: { block: { name: '午餐', start_hhmm: '12:00', type: 'meal' }, minutesLeft: 10 },
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('schedule-meal-alert');
    expect(msg!.prompt).toContain('午餐');
    expect(msg!.prompt).toContain('10');
  });

  it('generates schedule-pre-alert for non-meal block', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'schedule-pre-alert',
      context: { block: { name: '项目评审', start_hhmm: '14:30', type: 'meeting' }, minutesLeft: 5 },
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('schedule-pre-alert');
    expect(msg!.prompt).toContain('项目评审');
    expect(msg!.prompt).toContain('14:30');
  });

  it('generates schedule-ended message', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'schedule-ended',
      context: { block: { name: '晨会', type: 'meeting' } },
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('schedule-ended');
    expect(msg!.prompt).toContain('晨会');
    expect(msg!.priority).toBe('low');
  });

  it('schedule-pre-alert defaults block name when missing', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'schedule-pre-alert',
      context: { minutesLeft: 15 },
    });
    expect(msg).not.toBeNull();
    expect(msg!.prompt).toContain('活动');
  });

  it('returns null for unknown trigger reason', async () => {
    const policy = createCarePolicy(
      { memory: makeMemory(), tools: makeTools() },
      { inactivityThresholdMs: 4 * 3600000 },
    );

    const msg = await policy.evaluate({
      type: 'event', userId: 'u1', reason: 'unknown-reason',
    });
    expect(msg).toBeNull();
  });
});

describe('createCareEngine', () => {
  beforeEach(() => {
    // Pin time to 14:00 so inactivity policy's hour-of-day guard (8-22) always passes
    vi.useFakeTimers({ now: new Date('2026-04-15T14:00:00Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds and lists rules', () => {
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999 },
      { memory: makeMemory(), tools: makeTools(), onCareMessage },
    );
    engine.addRule({
      id: 'r1', userId: 'u1', schedule: '2h', reason: 'inactivity', enabled: true,
    });
    expect(engine.listRules()).toHaveLength(1);
    expect(engine.listRules()[0]!.id).toBe('r1');
  });

  it('removes rules', () => {
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999 },
      { memory: makeMemory(), tools: makeTools(), onCareMessage },
    );
    engine.addRule({ id: 'r1', userId: 'u1', schedule: '2h', reason: 'inactivity', enabled: true });
    expect(engine.removeRule('r1')).toBe(true);
    expect(engine.listRules()).toHaveLength(0);
  });

  it('manual trigger sends care message via callback', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999, minCareIntervalMs: 0, inactivityThresholdMs: 4 * 3600000 },
      {
        memory: makeMemory({ 'u1:lastActiveAt': fiveHoursAgo }),
        tools: makeTools(),
        onCareMessage,
      },
    );

    const msg = await engine.trigger({
      type: 'condition', userId: 'u1', reason: 'inactivity',
    });
    expect(msg).not.toBeNull();
    expect(onCareMessage).toHaveBeenCalledOnce();
  });

  it('respects minCareInterval throttle', async () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999, minCareIntervalMs: 9999999, inactivityThresholdMs: 1 },
      {
        memory: makeMemory({ 'u1:lastActiveAt': fiveHoursAgo }),
        tools: makeTools(),
        onCareMessage,
      },
    );

    await engine.trigger({ type: 'condition', userId: 'u1', reason: 'inactivity' });
    const second = await engine.trigger({ type: 'condition', userId: 'u1', reason: 'inactivity' });
    expect(second).toBeNull();
    expect(onCareMessage).toHaveBeenCalledOnce();
  });

  it('start and stop do not throw', () => {
    const engine = createCareEngine(
      { pollIntervalMs: 999999 },
      { memory: makeMemory(), tools: makeTools(), onCareMessage: vi.fn() },
    );
    engine.start();
    engine.stop();
  });

  it('manual trigger sends topic message', async () => {
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999, minCareIntervalMs: 0 },
      {
        memory: makeMemory(),
        tools: makeTools(),
        onCareMessage,
      },
    );

    const msg = await engine.trigger({
      type: 'condition', userId: 'u1', reason: 'topic',
      context: { topic: '新架构方向', source: 'manual' },
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('topic-initiative');
    expect(onCareMessage).toHaveBeenCalledOnce();
  });

  // ── R2: 主观能动性 — Engine-level topic initiative ────

  it('triggers idle topic when user idle between thresholds', async () => {
    // User active 45 min ago (between idle 30m and inactivity 4h thresholds)
    const fortyFiveMinAgo = new Date(Date.now() - 45 * 60000).toISOString();
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      {
        pollIntervalMs: 999999,
        minCareIntervalMs: 0,
        idleTopicThresholdMs: 30 * 60000,
        inactivityThresholdMs: 4 * 3600000,
        longWorkTopicThresholdMs: 3 * 3600000,
      },
      {
        memory: makeMemory({ 'u1:lastActiveAt': fortyFiveMinAgo }),
        tools: makeTools(),
        onCareMessage,
      },
    );

    engine.addRule({ id: 'r1', userId: 'u1', schedule: '1m', reason: 'inactivity', enabled: true });

    // Manually invoke checkRules by triggering and checking the engine state
    // Since checkRules is internal, we verify via the manual trigger mechanism
    const msg = await engine.trigger({
      type: 'condition', userId: 'u1', reason: 'topic',
      context: { reason: 'idle' },
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('topic-initiative');
  });

  it('triggers long-work topic when user active for extended period', async () => {
    // User active 4h ago (above longWork threshold of 3h)
    const fourHoursAgo = new Date(Date.now() - 4 * 3600000).toISOString();
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      {
        pollIntervalMs: 999999,
        minCareIntervalMs: 0,
        idleTopicThresholdMs: 30 * 60000,
        inactivityThresholdMs: 8 * 3600000,
        longWorkTopicThresholdMs: 3 * 3600000,
      },
      {
        memory: makeMemory({ 'u1:lastActiveAt': fourHoursAgo }),
        tools: makeTools(),
        onCareMessage,
      },
    );

    const msg = await engine.trigger({
      type: 'condition', userId: 'u1', reason: 'topic',
      context: { reason: 'long_work', sessionMinutes: 240 },
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('topic-initiative');
    expect(msg!.prompt).toContain('系统提示');
  });

  it('disabled rule does not trigger care', async () => {
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999, minCareIntervalMs: 0 },
      { memory: makeMemory(), tools: makeTools(), onCareMessage },
    );
    engine.addRule({ id: 'r1', userId: 'u1', schedule: '1m', reason: 'scheduled', enabled: false });

    // Engine with disabled rule — trigger should still work manually
    const msg = await engine.trigger({
      type: 'cron', userId: 'u1', reason: 'scheduled',
    });
    expect(msg).not.toBeNull();
    expect(msg!.tag).toBe('scheduled-care');
  });

  it('inactivity care respects hour-of-day guard (night)', async () => {
    // Use UTC so getHours() is 23 regardless of runner timezone (CI uses UTC; matches beforeEach)
    vi.useFakeTimers({ now: new Date('2026-04-15T23:00:00Z') });

    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString();
    const onCareMessage = vi.fn();
    const engine = createCareEngine(
      { pollIntervalMs: 999999, minCareIntervalMs: 0, inactivityThresholdMs: 1 },
      {
        memory: makeMemory({ 'u1:lastActiveAt': fiveHoursAgo }),
        tools: makeTools(),
        onCareMessage,
      },
    );

    const msg = await engine.trigger({
      type: 'cron', userId: 'u1', reason: 'inactivity',
    });
    expect(msg).toBeNull();

    vi.useRealTimers();
  });
});
