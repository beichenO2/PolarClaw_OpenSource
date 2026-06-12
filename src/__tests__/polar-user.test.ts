import { describe, it, expect } from 'vitest';
import { createPolarUserRegistry } from '../core/polar-user.js';

describe('R7: PolarUser 身份注册与解析', () => {
  it('resolves admin as PolarUser.human', () => {
    const registry = createPolarUserRegistry();
    const user = registry.resolve('admin');
    expect(user.kind).toBe('human');
    expect(user.group).toBe('PolarUser.human');
    expect(user.persona).toBe('admin');
    expect(user.memory_namespace).toBe('admin');
  });

  it('resolves unknown human user with defaults', () => {
    const registry = createPolarUserRegistry();
    const user = registry.resolve('someone');
    expect(user.kind).toBe('human');
    expect(user.group).toBe('PolarUser.human');
    expect(user.tool_scopes).toContain('*');
  });

  it('resolves project:knowlever as PolarUser.project', () => {
    const registry = createPolarUserRegistry();
    const user = registry.resolve('project:knowlever');
    expect(user.kind).toBe('project');
    expect(user.group).toBe('PolarUser.project');
    expect(user.project_id).toBe('knowlever');
    expect(user.persona).toBe('lobster-knowlever');
    expect(user.memory_namespace).toBe('project:knowlever');
  });

  it('dynamically creates unknown project users', () => {
    const registry = createPolarUserRegistry();
    const user = registry.resolve('project:newproject');
    expect(user.kind).toBe('project');
    expect(user.project_id).toBe('newproject');
    expect(user.persona).toBe('lobster-newproject');
  });

  it('project and human memory namespaces are isolated', () => {
    const registry = createPolarUserRegistry();
    const admin = registry.resolve('admin');
    const lobster = registry.resolve('project:knowlever');
    expect(admin.memory_namespace).not.toBe(lobster.memory_namespace);
  });

  it('lists 7 default project users', () => {
    const registry = createPolarUserRegistry();
    const projects = registry.listProjects();
    expect(projects.length).toBe(7);
    const ids = projects.map(p => p.project_id);
    expect(ids).toContain('knowlever');
    expect(ids).toContain('autooffice');
  });

  it('isProject and isHuman correctly classify', () => {
    const registry = createPolarUserRegistry();
    expect(registry.isProject('project:knowlever')).toBe(true);
    expect(registry.isHuman('project:knowlever')).toBe(false);
    expect(registry.isProject('admin')).toBe(false);
    expect(registry.isHuman('admin')).toBe(true);
  });

  it('project users have SDK scopes, human admin has wildcard tool scope', () => {
    const registry = createPolarUserRegistry();
    expect(registry.hasToolScope('admin', 'anything')).toBe(true);

    const lobster = registry.resolve('project:knowlever');
    expect(lobster.sdk_scopes).toContain('events:emit');
    expect(lobster.sdk_scopes).toContain('status:read');
    expect(lobster.sdk_scopes).toContain('health:run');
  });

  it('getPersonaName returns correct persona for each user type', () => {
    const registry = createPolarUserRegistry();
    expect(registry.getPersonaName('admin')).toBe('admin');
    expect(registry.getPersonaName('project:knowlever')).toBe('lobster-knowlever');
    expect(registry.getPersonaName('someone')).toBe('someone');
  });

  it('register adds a custom user to the registry', () => {
    const registry = createPolarUserRegistry();
    registry.register({
      id: 'custom-user',
      kind: 'human',
      group: 'PolarUser.human',
      display_name: 'Custom',
      persona: 'custom',
      memory_namespace: 'custom-user',
      tool_scopes: ['read'],
      sdk_scopes: [],
    });
    const user = registry.get('custom-user');
    expect(user).toBeDefined();
    expect(user!.display_name).toBe('Custom');
  });
});