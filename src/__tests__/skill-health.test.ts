import { describe, it, expect, vi } from 'vitest';
import { createSkillHealthMonitor, DEFAULT_HEALTH_CONFIG } from '../adapters/learning/skill-health.js';
import type { ILearningStore } from '../ports/learning.js';
import type { ISkillRegistry, ISkillMeta } from '../ports/skills.js';

function createMockLearningStore(overrides: Partial<ILearningStore> = {}): ILearningStore {
  return {
    recordUsage: vi.fn(), recordFeedback: vi.fn(), recordArrowLog: vi.fn(),
    getUsageHistory: vi.fn(() => []), getFeedback: vi.fn(() => []),
    getPreferences: vi.fn(() => []), getLearningContext: vi.fn(() => ({ preferences: [], patterns: [] })),
    savePattern: vi.fn(), findPatterns: vi.fn(() => []), promotePattern: vi.fn(),
    recordSkillUse: vi.fn(() => 0), getSkillUseCount: vi.fn(() => 0),
    getDistinctToolNames: vi.fn(() => []), getArrowLogs: vi.fn(() => []),
    ...overrides,
  } as ILearningStore;
}

function createMockSkillRegistry(skills: ISkillMeta[] = []): ISkillRegistry {
  const skillMap = new Map(skills.map(s => [s.name, s]));
  return {
    init: vi.fn(), watch: vi.fn(), unwatch: vi.fn(),
    loadSkill: vi.fn(async () => null), unloadSkill: vi.fn(() => true),
    listSkills: vi.fn(() => Array.from(skillMap.values())),
    getSkill: vi.fn((name: string) => skillMap.get(name)),
    on: vi.fn(), off: vi.fn(), onSkillLoaded: vi.fn(), onSkillUnloaded: vi.fn(),
  } as ISkillRegistry;
}

describe('Skill Health Monitor', () => {
  it('checkSkillHealth returns unused for unknown skill', () => {
    const store = createMockLearningStore();
    const registry = createMockSkillRegistry();
    const monitor = createSkillHealthMonitor(store, registry);
    const health = monitor.checkSkillHealth('unknown');
    expect(health.status).toBe('unused');
    expect(health.usageCount).toBe(0);
  });

  it('checkSkillHealth returns healthy for well-used skill', () => {
    const skill: ISkillMeta = { name: 'good-skill', description: 'good', path: '', origin: 'static', status: 'verified', successfulUses: 10, toolNames: ['tool_a'] };
    const store = createMockLearningStore({ getSkillUseCount: vi.fn(() => 10) });
    const registry = createMockSkillRegistry([skill]);
    const monitor = createSkillHealthMonitor(store, registry);
    const health = monitor.checkSkillHealth('good-skill');
    expect(health.status).toBe('healthy');
  });

  it('checkSkillHealth returns unused for low-usage skill', () => {
    const skill: ISkillMeta = { name: 'rare-skill', description: 'rare', path: '', origin: 'generated', status: 'draft', successfulUses: 0, toolNames: [] };
    const store = createMockLearningStore({ getSkillUseCount: vi.fn(() => 0) });
    const registry = createMockSkillRegistry([skill]);
    const monitor = createSkillHealthMonitor(store, registry);
    const health = monitor.checkSkillHealth('rare-skill');
    expect(health.status).toBe('unused');
  });

  it('getHealthReport covers all skills', () => {
    const skills: ISkillMeta[] = [
      { name: 'a', description: 'a', path: '', origin: 'static', status: 'verified', successfulUses: 5 },
      { name: 'b', description: 'b', path: '', origin: 'generated', status: 'draft', successfulUses: 0 },
    ];
    const store = createMockLearningStore({ getSkillUseCount: vi.fn(() => 5) });
    const registry = createMockSkillRegistry(skills);
    const monitor = createSkillHealthMonitor(store, registry);
    const report = monitor.getHealthReport();
    expect(report.length).toBe(2);
  });

  it('suggestActions returns correct actions', () => {
    const skill: ISkillMeta = { name: 'unused-skill', description: 'unused', path: '', origin: 'generated', status: 'draft', successfulUses: 0, toolNames: [] };
    const store = createMockLearningStore({ getSkillUseCount: vi.fn(() => 0) });
    const registry = createMockSkillRegistry([skill]);
    const monitor = createSkillHealthMonitor(store, registry);
    const actions = monitor.suggestActions();
    expect(actions.length).toBe(1);
    expect(actions[0]!.action).toBe('demote');
  });

  it('config defaults are correct', () => {
    expect(DEFAULT_HEALTH_CONFIG.unhealthySuccessRate).toBe(0.5);
    expect(DEFAULT_HEALTH_CONFIG.lowUsageThreshold).toBe(2);
    expect(DEFAULT_HEALTH_CONFIG.highErrorRate).toBe(0.3);
  });
});
