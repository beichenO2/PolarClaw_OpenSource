import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, HubPromptTimeoutError, HubPromptInvalidError, HubNetworkError } from '../adapters/web/hub-client.js';

const originalFetch = globalThis.fetch;

describe('R5: Hub Web 集成 (hub-client)', () => {
  let client: HubClient;

  beforeEach(() => {
    client = new HubClient('http://localhost:8040');
    // Stub connectSSE to prevent real EventSource creation
    vi.spyOn(client as any, 'connectSSE').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('getAgentId returns null before registration', () => {
    expect(client.getAgentId()).toBeNull();
  });

  it('getStatus returns initial state', () => {
    const status = client.getStatus();
    expect(status.agentId).toBeNull();
    expect(status.sseConnected).toBe(false);
    expect(status.lastHeartbeatAt).toBeNull();
    expect(status.lastPromptAt).toBeNull();
    expect(status.lastError).toBeNull();
  });

  it('register sends POST to hub and returns AgentInfo', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ agent_id: 'test-agent-123', hub_port: 8040 }),
    });

    const info = await client.register({
      hubUrl: 'http://localhost:8040',
      agentType: 'polarclaw',
      mainModel: 'glm-5.1',
      subagentModel: 'qwen-3.6-plus',
    });
    expect(info.agent_id).toBe('test-agent-123');
    expect(client.getAgentId()).toBe('test-agent-123');
  });

  it('register throws on non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(client.register({
      hubUrl: 'http://localhost:8040',
      agentType: 'polarclaw',
      mainModel: 'glm-5.1',
      subagentModel: 'qwen-3.6-plus',
    })).rejects.toThrow('Hub registration failed');
  });

  it('sendPrompt throws when not registered', async () => {
    await expect(client.sendPrompt('test', [])).rejects.toThrow('Not registered');
  });

  it('unregister clears agentId and closes connections', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ agent_id: 'test-agent', hub_port: 8040 }),
      })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await client.register({
      hubUrl: 'http://localhost:8040',
      agentType: 'polarclaw',
      mainModel: 'glm-5.1',
      subagentModel: 'qwen-3.6-plus',
    });
    expect(client.getAgentId()).toBe('test-agent');

    await client.unregister();
    expect(client.getAgentId()).toBeNull();
  });

  it('HubPromptTimeoutError has correct name and code', () => {
    const err = new HubPromptTimeoutError('timed out');
    expect(err.name).toBe('HubPromptTimeoutError');
    expect(err.code).toBe('timeout');
    expect(err instanceof Error).toBe(true);
  });

  it('HubPromptInvalidError has correct name and code', () => {
    const err = new HubPromptInvalidError('invalid');
    expect(err.name).toBe('HubPromptInvalidError');
    expect(err.code).toBe('invalid');
  });

  it('HubNetworkError has correct name and code', () => {
    const err = new HubNetworkError('network error');
    expect(err.name).toBe('HubNetworkError');
    expect(err.code).toBe('network');
  });
});