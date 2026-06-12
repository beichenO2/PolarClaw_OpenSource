import { describe, it, expect, vi } from 'vitest';
import { createToolExecutor } from '../adapters/tools/tool-executor.js';

function makeTool(name: string, handler: (args: Record<string, unknown>) => unknown) {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: 'object', properties: {} },
    handler,
  };
}

describe('createToolExecutor', () => {
  it('registers and executes a tool', async () => {
    const executor = createToolExecutor();
    executor.register(makeTool('echo', (args) => args));
    const result = await executor.execute('echo', { msg: 'hi' });
    expect(result).toEqual({ msg: 'hi' });
  });

  it('lists registered tools in function calling format', () => {
    const executor = createToolExecutor();
    executor.register(makeTool('a', () => 1));
    executor.register(makeTool('b', () => 2));
    const list = executor.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.type).toBe('function');
    expect(list[0]!.function.name).toBe('a');
  });

  it('throws on unknown tool', async () => {
    const executor = createToolExecutor();
    await expect(executor.execute('nope', {})).rejects.toThrow('未注册的工具');
  });

  it('unregisters a tool', () => {
    const executor = createToolExecutor();
    executor.register(makeTool('x', () => null));
    expect(executor.has('x')).toBe(true);
    expect(executor.unregister('x')).toBe(true);
    expect(executor.has('x')).toBe(false);
  });

  it('times out slow tools', async () => {
    const executor = createToolExecutor({ timeoutMs: 50 });
    executor.register(makeTool('slow', () => new Promise((r) => setTimeout(r, 500))));
    await expect(executor.execute('slow', {})).rejects.toThrow('超时');
  });

  it('runs beforeExecute hook', async () => {
    const hook = vi.fn();
    const executor = createToolExecutor({ beforeExecute: hook });
    executor.register(makeTool('t', () => 'ok'));
    await executor.execute('t', { a: 1 });
    expect(hook).toHaveBeenCalledWith('t', { a: 1 });
  });

  it('blocks execution when beforeExecute throws', async () => {
    const executor = createToolExecutor({
      beforeExecute: async () => { throw new Error('denied'); },
    });
    executor.register(makeTool('t', () => 'ok'));
    await expect(executor.execute('t', {})).rejects.toThrow('denied');
  });
});
