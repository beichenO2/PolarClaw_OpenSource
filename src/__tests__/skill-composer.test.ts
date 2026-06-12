import { describe, it, expect, vi } from 'vitest';
import { createSkillComposer } from '../adapters/learning/skill-composer.js';
import type { IToolExecutor, IToolHandler } from '../ports/tools.js';

function createMockToolExecutor(): IToolExecutor {
  const tools = new Map<string, IToolHandler>();
  return {
    register: vi.fn((tool: IToolHandler) => { tools.set(tool.name, tool); }),
    unregister: vi.fn((name: string) => { tools.delete(name); return true; }),
    execute: vi.fn(async (name: string, args: Record<string, unknown>) => {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Tool not found: ${name}`);
      return tool.handler(args);
    }),
    list: vi.fn(() => [] as any[]),
    has: vi.fn((name: string) => tools.has(name)),
  };
}

describe('R5: 自学习/工作流组合 (skill-composer)', () => {
  it('compose registers a workflow as a composite tool and returns tool name', () => {
    const executor = createMockToolExecutor();
    const composer = createSkillComposer(executor);

    const toolName = composer.compose({
      name: 'test-workflow',
      toolName: 'workflow_test',
      description: 'A test workflow',
      inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
      steps: [
        { id: 'step1', tool: 'some_tool', args: { data: '$input.value' } },
      ],
    });

    expect(toolName).toBe('workflow_test');
    expect(executor.register).toHaveBeenCalled();
    const registeredTool = (executor.register as unknown as { mock: { calls: IToolHandler[][] } }).mock.calls[0]![0] as IToolHandler;
    expect(registeredTool.name).toBe('workflow_test');
  });

  it('compose with dependent steps registers the workflow', () => {
    const executor = createMockToolExecutor();
    const composer = createSkillComposer(executor);

    const toolName = composer.compose({
      name: 'chained-workflow',
      toolName: 'workflow_chained',
      description: 'A chained workflow',
      inputSchema: { type: 'object', properties: {} },
      steps: [
        { id: 'step1', tool: 'tool_a', args: {} },
        { id: 'step2', tool: 'tool_b', args: { data: '$steps.step1.result' }, dependsOn: ['step1'] },
      ],
    });

    expect(toolName).toBe('workflow_chained');
  });

  it('compose with conditional step registers the workflow', () => {
    const executor = createMockToolExecutor();
    const composer = createSkillComposer(executor);

    const toolName = composer.compose({
      name: 'conditional-workflow',
      toolName: 'workflow_conditional',
      description: 'A workflow with conditions',
      inputSchema: { type: 'object', properties: {} },
      steps: [
        { id: 'check', tool: 'check_tool', args: {} },
        { id: 'action', tool: 'action_tool', args: {}, dependsOn: ['check'], condition: '$steps.check.exists == true' },
      ],
    });

    expect(toolName).toBe('workflow_conditional');
  });

  it('parseWorkflow parses a valid JSON workflow definition', () => {
    const executor = createMockToolExecutor();
    const composer = createSkillComposer(executor);

    const json = JSON.stringify({
      name: 'parsed-workflow',
      toolName: 'workflow_parsed',
      description: 'Parsed from JSON',
      inputSchema: { type: 'object', properties: {} },
      steps: [{ id: 's1', tool: 't1', args: {} }],
    });

    const workflow = composer.parseWorkflow(json);
    expect(workflow.name).toBe('parsed-workflow');
    expect(workflow.toolName).toBe('workflow_parsed');
    expect(workflow.steps.length).toBe(1);
  });

  it('parseWorkflow throws on invalid JSON', () => {
    const executor = createMockToolExecutor();
    const composer = createSkillComposer(executor);
    expect(() => composer.parseWorkflow('not json')).toThrow();
  });
});