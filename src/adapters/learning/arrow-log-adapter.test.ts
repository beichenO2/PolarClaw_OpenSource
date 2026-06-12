import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createLearningStore } from './feedback-store.js';
import { createArrowLogAdapter, createArrowLogRoutes, type ArrowLogInput } from './arrow-log-adapter.js';

let tmpDir: string;
let dbPath: string;
let learningStore: ReturnType<typeof createLearningStore>;
let adapter: ReturnType<typeof createArrowLogAdapter>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'arrow-adapter-test-'));
  dbPath = join(tmpDir, 'test.db');
  learningStore = createLearningStore(dbPath);
  adapter = createArrowLogAdapter(learningStore);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createArrowLogAdapter', () => {
  describe('receive', () => {
    it('accepts valid arrow log', () => {
      const log: ArrowLogInput = {
        project_id: 'test-project',
        target_id: 'target-1',
        ts: '2026-05-10T10:00:00Z',
        outcome: 'hit',
        delta: '修改了 src/utils.ts',
        next_action: 'shoot',
      };

      const result = adapter.receive(log);
      expect(result.success).toBe(true);
    });

    it('rejects invalid project_id', () => {
      const log = {
        project_id: '',
        target_id: 'target-1',
        ts: '2026-05-10T10:00:00Z',
        outcome: 'hit' as const,
        delta: 'test',
        next_action: 'shoot' as const,
      };

      const result = adapter.receive(log);
      expect(result.success).toBe(false);
      expect(result.error).toContain('project_id');
    });

    it('rejects invalid outcome', () => {
      const log = {
        project_id: 'test-project',
        target_id: 'target-1',
        ts: '2026-05-10T10:00:00Z',
        outcome: 'invalid' as any,
        delta: 'test',
        next_action: 'shoot' as const,
      };

      const result = adapter.receive(log);
      expect(result.success).toBe(false);
      expect(result.error).toContain('outcome');
    });

    it('rejects invalid next_action', () => {
      const log = {
        project_id: 'test-project',
        target_id: 'target-1',
        ts: '2026-05-10T10:00:00Z',
        outcome: 'hit' as const,
        delta: 'test',
        next_action: 'invalid' as any,
      };

      const result = adapter.receive(log);
      expect(result.success).toBe(false);
      expect(result.error).toContain('next_action');
    });
  });

  describe('receiveBatch', () => {
    it('accepts multiple valid logs', () => {
      const logs: ArrowLogInput[] = [
        { project_id: 'p1', target_id: 't1', ts: '2026-05-10T10:00:00Z', outcome: 'hit', delta: 'd1', next_action: 'shoot' },
        { project_id: 'p1', target_id: 't2', ts: '2026-05-10T10:01:00Z', outcome: 'miss', delta: 'd2', next_action: 'moveboard' },
      ];

      const result = adapter.receiveBatch(logs);
      expect(result.success).toBe(true);
      expect(result.received).toBe(2);
    });

    it('handles partial failures', () => {
      const logs: ArrowLogInput[] = [
        { project_id: 'p1', target_id: 't1', ts: '2026-05-10T10:00:00Z', outcome: 'hit', delta: 'd1', next_action: 'shoot' },
        { project_id: '', target_id: 't2', ts: '2026-05-10T10:01:00Z', outcome: 'miss', delta: 'd2', next_action: 'moveboard' }, // invalid
      ];

      const result = adapter.receiveBatch(logs);
      expect(result.success).toBe(false);
      expect(result.received).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('query', () => {
    it('returns empty array for no logs', () => {
      const logs = adapter.query('nonexistent-project');
      expect(logs).toEqual([]);
    });

    it('returns stored logs', () => {
      adapter.receive({
        project_id: 'test-project',
        target_id: 't1',
        ts: '2026-05-10T10:00:00Z',
        outcome: 'hit',
        delta: 'test delta',
        next_action: 'shoot',
      });

      const logs = adapter.query('test-project');
      expect(logs.length).toBe(1);
      expect(logs[0]!.projectId).toBe('test-project');
      expect(logs[0]!.targetId).toBe('t1');
      expect(logs[0]!.outcome).toBe('hit');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        adapter.receive({
          project_id: 'test-project',
          target_id: `t${i}`,
          ts: `2026-05-10T10:0${i}:00Z`,
          outcome: 'hit',
          delta: `delta ${i}`,
          next_action: 'shoot',
        });
      }

      const logs = adapter.query('test-project', 5);
      expect(logs.length).toBe(5);
    });
  });
});

describe('createArrowLogRoutes', () => {
  it('handlePost accepts single log', () => {
    const routes = createArrowLogRoutes(adapter);
    const log: ArrowLogInput = {
      project_id: 'p1',
      target_id: 't1',
      ts: '2026-05-10T10:00:00Z',
      outcome: 'hit',
      delta: 'test',
      next_action: 'shoot',
    };

    const result = routes.handlePost({ body: log });
    expect(result.success).toBe(true);
  });

  it('handlePost accepts batch logs', () => {
    const routes = createArrowLogRoutes(adapter);
    const logs: ArrowLogInput[] = [
      { project_id: 'p1', target_id: 't1', ts: '2026-05-10T10:00:00Z', outcome: 'hit', delta: 'd1', next_action: 'shoot' },
      { project_id: 'p1', target_id: 't2', ts: '2026-05-10T10:01:00Z', outcome: 'miss', delta: 'd2', next_action: 'moveboard' },
    ];

    const result = routes.handlePost({ body: logs }) as { success: boolean; received: number };
    expect(result.success).toBe(true);
    expect(result.received).toBe(2);
  });

  it('handleGet returns logs', () => {
    adapter.receive({
      project_id: 'test-project',
      target_id: 't1',
      ts: '2026-05-10T10:00:00Z',
      outcome: 'hit',
      delta: 'test',
      next_action: 'shoot',
    });

    const routes = createArrowLogRoutes(adapter);
    const logs = routes.handleGet('test-project');
    expect(logs.length).toBe(1);
  });
});
