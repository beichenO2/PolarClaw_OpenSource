import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  isLocked,
  getLockInfo,
  getLockAgeMs,
  acquireLock,
  releaseLock,
  LockInfo,
} from './project-lock.js';

const LOCK_FILE_NAME = '.lobster-lock';
const PROJECT_ID = 'vitest-test-project';

function lockPath(projectId: string): string {
  return join(homedir(), 'Polarisor', projectId, LOCK_FILE_NAME);
}

function ensureDir(projectId: string): void {
  const dir = join(homedir(), 'Polarisor', projectId);
  mkdirSync(dir, { recursive: true });
}

function cleanup(): void {
  const p = lockPath(PROJECT_ID);
  if (existsSync(p)) unlinkSync(p);
}

describe('project-lock', () => {
  beforeEach(() => {
    ensureDir(PROJECT_ID);
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe('isLocked', () => {
    it('returns false when no lock exists', () => {
      expect(isLocked(PROJECT_ID)).toBe(false);
    });

    it('returns true when lock file exists', () => {
      const p = lockPath(PROJECT_ID);
      writeFileSync(p, JSON.stringify({ holder: 'test', reason: 'test', locked_at: new Date().toISOString(), pid: 123 }));
      expect(isLocked(PROJECT_ID)).toBe(true);
    });
  });

  describe('getLockInfo', () => {
    it('returns null when no lock exists', () => {
      expect(getLockInfo(PROJECT_ID)).toBeNull();
    });

    it('returns lock info when lock file exists', () => {
      const p = lockPath(PROJECT_ID);
      const info: LockInfo = { holder: 'holder1', reason: 'testing', locked_at: new Date().toISOString(), pid: 999 };
      writeFileSync(p, JSON.stringify(info));
      const result = getLockInfo(PROJECT_ID);
      expect(result).toEqual(info);
    });

    it('returns null for malformed JSON', () => {
      const p = lockPath(PROJECT_ID);
      writeFileSync(p, 'not-json');
      expect(getLockInfo(PROJECT_ID)).toBeNull();
    });
  });

  describe('getLockAgeMs', () => {
    it('returns null when no lock exists', () => {
      expect(getLockAgeMs(PROJECT_ID)).toBeNull();
    });

    it('returns positive age for existing lock', () => {
      const p = lockPath(PROJECT_ID);
      const oldDate = new Date(Date.now() - 5000).toISOString();
      writeFileSync(p, JSON.stringify({ holder: 'test', reason: 'test', locked_at: oldDate, pid: 123 }));
      const age = getLockAgeMs(PROJECT_ID);
      expect(age).toBeGreaterThanOrEqual(5000);
    });
  });

  describe('acquireLock', () => {
    it('returns true when lock is acquired', () => {
      const result = acquireLock(PROJECT_ID, 'holder1', 'test reason');
      expect(result).toBe(true);
      expect(isLocked(PROJECT_ID)).toBe(true);
    });

    it('returns false when already locked', () => {
      acquireLock(PROJECT_ID, 'holder1', 'first');
      const result = acquireLock(PROJECT_ID, 'holder2', 'second');
      expect(result).toBe(false);
    });

    it('stores correct lock info', () => {
      acquireLock(PROJECT_ID, 'my-holder', 'my reason');
      const info = getLockInfo(PROJECT_ID);
      expect(info?.holder).toBe('my-holder');
      expect(info?.reason).toBe('my reason');
      expect(info?.pid).toBe(process.pid);
      expect(info?.locked_at).toBeTruthy();
    });
  });

  describe('releaseLock', () => {
    it('returns false when no lock exists', () => {
      expect(releaseLock(PROJECT_ID, 'anyone')).toBe(false);
    });

    it('returns false when holder does not match', () => {
      acquireLock(PROJECT_ID, 'holder1', 'test');
      expect(releaseLock(PROJECT_ID, 'wrong-holder')).toBe(false);
      expect(isLocked(PROJECT_ID)).toBe(true);
    });

    it('returns true and removes lock when holder matches', () => {
      acquireLock(PROJECT_ID, 'correct-holder', 'test');
      const result = releaseLock(PROJECT_ID, 'correct-holder');
      expect(result).toBe(true);
      expect(isLocked(PROJECT_ID)).toBe(false);
    });
  });
});
