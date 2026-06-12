import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const LOCK_FILE_NAME = '.lobster-lock';

export interface LockInfo {
  holder: string;
  reason: string;
  locked_at: string;
  pid: number;
}

function lockPath(projectId: string): string {
  return join(homedir(), 'Polarisor', projectId, LOCK_FILE_NAME);
}

export function isLocked(projectId: string): boolean {
  return existsSync(lockPath(projectId));
}

export function getLockInfo(projectId: string): LockInfo | null {
  const p = lockPath(projectId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as LockInfo;
  } catch { return null; }
}

export function getLockAgeMs(projectId: string): number | null {
  const info = getLockInfo(projectId);
  if (!info) return null;
  return Date.now() - new Date(info.locked_at).getTime();
}

export function acquireLock(projectId: string, holder: string, reason: string): boolean {
  const p = lockPath(projectId);
  if (existsSync(p)) return false;
  const dir = join(homedir(), 'Polarisor', projectId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const info: LockInfo = {
    holder,
    reason,
    locked_at: new Date().toISOString(),
    pid: process.pid,
  };
  writeFileSync(p, JSON.stringify(info, null, 2));
  return true;
}

export function releaseLock(projectId: string, holder: string): boolean {
  const p = lockPath(projectId);
  const info = getLockInfo(projectId);
  if (!info) return false;
  if (info.holder !== holder) return false;
  unlinkSync(p);
  return true;
}
