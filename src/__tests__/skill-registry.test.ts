import { describe, it, expect, vi } from 'vitest';
import { createSkillRegistry } from '../adapters/skills/skill-registry.js';
import type { IToolExecutor, IToolHandler } from '../ports/tools.js';

function createMockToolExecutor(): IToolExecutor {
  const tools = new Map<string, IToolHandler>();
  return {
    register: vi.fn((tool: IToolHandler) => { tools.set(tool.name, tool); }),
    unregister: vi.fn((name: string) => { tools.delete(name); return true; }),
    execute: vi.fn(),
    list: vi.fn(() => [] as any[]),
    has: vi.fn((name: string) => tools.has(name)),
  };
}

describe('R5: 技能注册 (skill-registry)', () => {
  it('creates a registry with all expected methods', () => {
    const executor = createMockToolExecutor();
    const registry = createSkillRegistry(executor);

    expect(typeof registry.init).toBe('function');
    expect(typeof registry.listSkills).toBe('function');
    expect(typeof registry.getSkill).toBe('function');
    expect(typeof registry.loadSkill).toBe('function');
    expect(typeof registry.unloadSkill).toBe('function');
    expect(typeof registry.watch).toBe('function');
    expect(typeof registry.unwatch).toBe('function');
    expect(typeof registry.on).toBe('function');
    expect(typeof registry.off).toBe('function');
  });

  it('init with non-existent dirs returns empty skill list', async () => {
    const executor = createMockToolExecutor();
    const registry = createSkillRegistry(executor);

    await registry.init(['/nonexistent/skills/dir']);
    expect(registry.listSkills()).toEqual([]);
  });

  it('init with loadTools=false skips tool registration', async () => {
    const executor = createMockToolExecutor();
    const registry = createSkillRegistry(executor);

    await registry.init(['/nonexistent'], { loadTools: false });
    expect(executor.register).not.toHaveBeenCalled();
  });

  it('getSkill returns undefined for non-existent skill', () => {
    const executor = createMockToolExecutor();
    const registry = createSkillRegistry(executor);
    expect(registry.getSkill('nonexistent')).toBeUndefined();
  });

  it('unloadSkill returns false for non-existent skill', () => {
    const executor = createMockToolExecutor();
    const registry = createSkillRegistry(executor);
    expect(registry.unloadSkill('nonexistent')).toBe(false);
  });

  it('on/off registers and removes event handlers', () => {
    const executor = createMockToolExecutor();
    const registry = createSkillRegistry(executor);
    const handler = vi.fn();
    registry.on(handler);
    registry.off(handler);
    // No error means success
  });

  it('loadSkill returns null for non-existent directory', async () => {
    const executor = createMockToolExecutor();
    const registry = createSkillRegistry(executor);
    const result = await registry.loadSkill('/nonexistent/skill-dir');
    expect(result).toBeNull();
  });
});