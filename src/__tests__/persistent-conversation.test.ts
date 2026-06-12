import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createPersistentConversation } from '../adapters/memory/persistent-conversation.js';

describe('createPersistentConversation', () => {
  let dbPath: string;
  let tempDir: string;
  let conv: ReturnType<typeof createPersistentConversation>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'polarclaw-conv-test-'));
    dbPath = join(tempDir, 'test.db');
    conv = createPersistentConversation({ dbPath, maxMessages: 10, maxTokens: 5000 });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends and retrieves messages in order', () => {
    conv.append('c1', { role: 'user', content: 'hello' });
    conv.append('c1', { role: 'assistant', content: 'hi there' });
    const history = conv.getHistory('c1');
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe('user');
    expect(history[1]!.role).toBe('assistant');
  });

  it('isolates conversations by ID', () => {
    conv.append('c1', { role: 'user', content: 'conv1' });
    conv.append('c2', { role: 'user', content: 'conv2' });
    expect(conv.getHistory('c1')).toHaveLength(1);
    expect(conv.getHistory('c2')).toHaveLength(1);
    expect(conv.getHistory('c1')[0]!.content).toBe('conv1');
  });

  it('preserves toolCalls and toolCallId', () => {
    conv.append('c1', {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', function: { name: 'search', arguments: '{"q":"test"}' } }],
    });
    conv.append('c1', { role: 'tool', content: '{"result":42}', toolCallId: 'tc1' });
    const history = conv.getHistory('c1');
    expect(history[0]!.toolCalls![0]!.function.name).toBe('search');
    expect(history[1]!.toolCallId).toBe('tc1');
  });

  it('trims old messages when exceeding maxMessages', () => {
    for (let i = 0; i < 15; i++) {
      conv.append('c1', { role: 'user', content: `msg ${i}` });
    }
    const history = conv.getHistory('c1');
    expect(history.length).toBeLessThanOrEqual(10);
    expect(history[history.length - 1]!.content).toBe('msg 14');
  });

  it('clears conversation', () => {
    conv.append('c1', { role: 'user', content: 'hello' });
    conv.clear('c1');
    expect(conv.getHistory('c1')).toHaveLength(0);
  });

  it('estimates tokens', () => {
    conv.append('c1', { role: 'user', content: 'hello world test message' });
    const tokens = conv.estimateTokens('c1');
    expect(tokens).toBeGreaterThan(0);
  });

  it('supports getHistory with limit and fromLatest', () => {
    for (let i = 0; i < 8; i++) {
      conv.append('c1', { role: 'user', content: `msg ${i}` });
    }
    const latest3 = conv.getHistory('c1', { limit: 3, fromLatest: true });
    expect(latest3).toHaveLength(3);
    expect(latest3[2]!.content).toBe('msg 7');

    const first3 = conv.getHistory('c1', { limit: 3 });
    expect(first3).toHaveLength(3);
    expect(first3[0]!.content).toBe('msg 0');
  });

  it('persists across instances', () => {
    conv.append('c1', { role: 'user', content: 'persistent' });
    const conv2 = createPersistentConversation({ dbPath, maxMessages: 10 });
    const history = conv2.getHistory('c1');
    expect(history).toHaveLength(1);
    expect(history[0]!.content).toBe('persistent');
  });
});
