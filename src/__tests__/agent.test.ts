import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgent, type IAgentDeps, type IAgentConfig } from '../core/agent.js';

function makeConfig(overrides: Partial<IAgentConfig> = {}): IAgentConfig {
  return {
    maxToolRounds: 5,
    systemPrompt: 'You are a test agent.',
    temperature: 0.7,
    maxTokens: 4096,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<IAgentDeps> = {}): IAgentDeps {
  const history: Array<{ role: string; content: string }> = [];
  return {
    llm: {
      chat: vi.fn().mockResolvedValue({
        content: 'test reply',
        toolCalls: [],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    } as any,
    memory: {
      saveProfile: vi.fn(),
      getAllProfiles: vi.fn().mockReturnValue([]),
      search: vi.fn().mockReturnValue({ entries: [], total: 0 }),
    } as any,
    conversations: {
      append: vi.fn().mockImplementation((_id: string, msg: any) => history.push(msg)),
      getHistory: vi.fn().mockReturnValue(history),
      clear: vi.fn(),
      estimateTokens: vi.fn().mockReturnValue(100),
    } as any,
    tools: {
      list: vi.fn().mockReturnValue([]),
      execute: vi.fn(),
      has: vi.fn(),
      register: vi.fn(),
      unregister: vi.fn(),
    } as any,
    privacy: {
      sanitize: vi.fn().mockResolvedValue({ blocked: false, sanitized: 'test input', entities: [] }),
      desanitize: vi.fn().mockImplementation((_userId: string, text: string) => text),
      loadEntities: vi.fn().mockResolvedValue([]),
      clearVault: vi.fn(),
    } as any,
    ...overrides,
  };
}

describe('createAgent', () => {
  it('returns text response for simple message', async () => {
    const deps = makeDeps();
    const agent = createAgent(makeConfig(), deps);
    const result = await agent.handleMessage('cli', 'user1', 'hello');
    expect(result.text).toBe('test reply');
    expect(result.blocked).toBe(false);
    expect(result.usage).toBeDefined();
  });

  it('blocks message when privacy sanitize blocks', async () => {
    const deps = makeDeps({
      privacy: {
        sanitize: vi.fn().mockResolvedValue({ blocked: true, warning: '敏感信息' }),
        desanitize: vi.fn(),
        loadEntities: vi.fn(),
        clearVault: vi.fn(),
      } as any,
    });
    const agent = createAgent(makeConfig(), deps);
    const result = await agent.handleMessage('cli', 'user1', 'secret stuff');
    expect(result.blocked).toBe(true);
    expect(result.text).toContain('敏感信息');
  });

  it('appends isOngoing hint for ongoing conversations', async () => {
    const history = [
      { role: 'user', content: 'prev msg' },
      { role: 'assistant', content: 'prev reply' },
      { role: 'user', content: 'followup' },
    ];
    const deps = makeDeps({
      conversations: {
        append: vi.fn(),
        getHistory: vi.fn().mockReturnValue(history),
        clear: vi.fn(),
        estimateTokens: vi.fn().mockReturnValue(100),
      } as any,
    });
    const agent = createAgent(makeConfig(), deps);
    await agent.handleMessage('cli', 'user1', 'followup');
    const chatCalls = (deps.llm.chat as any).mock.calls;
    const systemMsg = chatCalls[0][0][0];
    expect(systemMsg.content).toContain('无需重新自我介绍');
  });

  it('executes tool calls and feeds results back', async () => {
    let callCount = 0;
    const deps = makeDeps({
      llm: {
        chat: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              content: '',
              toolCalls: [{
                id: 'tc1',
                function: { name: 'echo', arguments: '{"msg":"hi"}' },
              }],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
            };
          }
          return { content: 'done', toolCalls: [], usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 } };
        }),
      } as any,
      tools: {
        list: vi.fn().mockReturnValue([]),
        execute: vi.fn().mockResolvedValue({ echoed: 'hi' }),
        has: vi.fn(),
        register: vi.fn(),
        unregister: vi.fn(),
      } as any,
    });
    const agent = createAgent(makeConfig(), deps);
    const result = await agent.handleMessage('cli', 'user1', 'echo something');
    expect(deps.tools.execute).toHaveBeenCalledWith('echo', { msg: 'hi' });
    expect(result.text).toBe('done');
  });

  it('respects maxToolRounds limit', async () => {
    const deps = makeDeps({
      llm: {
        chat: vi.fn().mockResolvedValue({
          content: '',
          toolCalls: [{
            id: 'tc',
            function: { name: 'loop', arguments: '{}' },
          }],
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
        }),
      } as any,
      tools: {
        list: vi.fn().mockReturnValue([]),
        execute: vi.fn().mockResolvedValue('ok'),
        has: vi.fn(),
        register: vi.fn(),
        unregister: vi.fn(),
      } as any,
    });
    const agent = createAgent(makeConfig({ maxToolRounds: 2 }), deps);
    const result = await agent.handleMessage('cli', 'user1', 'loop');
    expect(result.text).toContain('工具调用轮数上限');
    expect(deps.llm.chat).toHaveBeenCalledTimes(2);
  });

  it('accumulates token usage across rounds', async () => {
    let callCount = 0;
    const deps = makeDeps({
      llm: {
        chat: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              content: '',
              toolCalls: [{ id: 'tc1', function: { name: 't', arguments: '{}' } }],
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
            };
          }
          return { content: 'final', toolCalls: [], usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 } };
        }),
      } as any,
      tools: {
        list: vi.fn().mockReturnValue([]),
        execute: vi.fn().mockResolvedValue('ok'),
        has: vi.fn(),
        register: vi.fn(),
        unregister: vi.fn(),
      } as any,
    });
    const agent = createAgent(makeConfig(), deps);
    const result = await agent.handleMessage('cli', 'user1', 'go');
    expect(result.usage!.totalTokens).toBe(260);
  });

  it('reports tool count from getStatus', () => {
    const deps = makeDeps({
      tools: {
        list: vi.fn().mockReturnValue([{}, {}, {}]),
        execute: vi.fn(),
        has: vi.fn(),
        register: vi.fn(),
        unregister: vi.fn(),
      } as any,
    });
    const agent = createAgent(makeConfig(), deps);
    expect(agent.getStatus().toolCount).toBe(3);
  });
});
