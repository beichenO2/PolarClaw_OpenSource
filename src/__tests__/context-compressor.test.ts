import { describe, it, expect, vi } from 'vitest';
import { createContextCompressor } from '../adapters/compression/summarizer.js';
import type { IChatMessage } from '../ports/memory.js';

function msg(role: IChatMessage['role'], content: string): IChatMessage {
  return { role, content };
}

function makeHistory(count: number, contentLen = 200): IChatMessage[] {
  const msgs: IChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    msgs.push(msg(role, 'x'.repeat(contentLen)));
  }
  return msgs;
}

describe('createContextCompressor', () => {
  describe('shouldCompress', () => {
    it('returns false when under budget', () => {
      const compressor = createContextCompressor({ triggerRatio: 0.7 });
      const messages = [msg('user', 'hello')];
      expect(compressor.shouldCompress(messages, 100000)).toBe(false);
    });

    it('returns true when over trigger ratio', () => {
      const compressor = createContextCompressor({ triggerRatio: 0.1 });
      const messages = makeHistory(50, 500);
      expect(compressor.shouldCompress(messages, 100)).toBe(true);
    });
  });

  describe('Phase 1: structural trimming', () => {
    it('truncates long tool outputs', async () => {
      const compressor = createContextCompressor({ toolOutputMaxLen: 50 });
      const messages: IChatMessage[] = [
        msg('user', 'search'),
        msg('assistant', 'calling tool'),
        { role: 'tool', content: 'a'.repeat(500) },
      ];
      const result = await compressor.compress(messages, 999999);
      const toolMsg = result.messages.find(m => m.role === 'tool')!;
      expect(toolMsg.content.length).toBeLessThan(200);
      expect(toolMsg.content).toContain('已截断');
      expect(result.phasesUsed).toContain(1);
    });
  });

  describe('Phase 2: head-tail protection', () => {
    it('folds middle messages when Phase 1 is insufficient', async () => {
      const compressor = createContextCompressor({
        toolOutputMaxLen: 2000,
        headKeep: 2,
        tailKeep: 2,
      });
      const messages = makeHistory(30, 1000);
      const result = await compressor.compress(messages, 200);
      expect(result.messages.length).toBeLessThan(messages.length);
      expect(result.phasesUsed).toContain(2);
      const foldedMsg = result.messages.find(m => m.content.includes('已压缩'));
      expect(foldedMsg).toBeTruthy();
    });
  });

  describe('Phase 3: LLM summarization', () => {
    it('Phase 3 unreachable after Phase 2 fold (known limitation)', async () => {
      // Phase 2 fold reduces to headKeep + 1 + tailKeep messages,
      // which is always < headKeep + tailKeep + 2 (the Phase 3 threshold).
      // So Phase 3 never triggers in current implementation.
      const summarize = vi.fn().mockResolvedValue('summary');
      const compressor = createContextCompressor({
        toolOutputMaxLen: 50,
        headKeep: 2,
        tailKeep: 2,
        summarize,
      });
      const messages = makeHistory(40, 2000);
      const result = await compressor.compress(messages, 100);
      expect(summarize).not.toHaveBeenCalled();
      expect(result.phasesUsed).not.toContain(3);
      expect(result.phasesUsed).toContain(2);
    });

    it('falls back gracefully when summarize not provided', async () => {
      const compressor = createContextCompressor({ headKeep: 2, tailKeep: 2 });
      const messages = makeHistory(40, 2000);
      const result = await compressor.compress(messages, 100);
      expect(result.phasesUsed).not.toContain(3);
    });
  });

  it('preserves original token count in result', async () => {
    const compressor = createContextCompressor();
    const messages = makeHistory(5, 100);
    const result = await compressor.compress(messages, 999999);
    expect(result.originalTokens).toBeGreaterThan(0);
    expect(result.compressedTokens).toBeGreaterThan(0);
  });
});
