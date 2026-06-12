/**
 * 飞书消息去重与补漏模块
 *
 * 参照 OpenClaw 持久化去重设计：
 * - 内存 LRU 缓存 + 磁盘 JSON 持久化
 * - 记录最后处理消息时间戳，用于启动时补漏
 * - 24h TTL，超过的记录自动清理
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MEMORY_SIZE = 1000;
const MAX_DISK_ENTRIES = 5000;

interface DedupState {
  /** message_id → 处理时间戳 (ms) */
  processed: Record<string, number>;
  /** 最后一条处理消息的 create_time（飞书时间戳，秒级字符串） */
  lastProcessedTime?: string;
}

export interface IFeishuDedup {
  isProcessed(messageId: string): boolean;
  markProcessed(messageId: string, createTime?: string): void;
  getLastProcessedTime(): string | undefined;
  flush(): void;
}

export function createFeishuDedup(dataDir: string, namespace = 'default'): IFeishuDedup {
  const filePath = join(dataDir, 'feishu-dedup', `${namespace}.json`);
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const memory = new Map<string, number>();
  let lastProcessedTime: string | undefined;
  let dirty = false;

  function loadFromDisk(): void {
    if (!existsSync(filePath)) return;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const state: DedupState = JSON.parse(raw);
      const now = Date.now();
      for (const [id, ts] of Object.entries(state.processed)) {
        if (now - ts < DEDUP_TTL_MS) {
          memory.set(id, ts);
        }
      }
      lastProcessedTime = state.lastProcessedTime;
    } catch {
      /* corrupted file, start fresh */
    }
  }

  function saveToDisk(): void {
    if (!dirty) return;
    const now = Date.now();
    const entries: Record<string, number> = {};
    let count = 0;

    const sorted = [...memory.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, ts] of sorted) {
      if (now - ts >= DEDUP_TTL_MS) continue;
      if (count >= MAX_DISK_ENTRIES) break;
      entries[id] = ts;
      count++;
    }

    const state: DedupState = {
      processed: entries,
      lastProcessedTime,
    };
    try {
      writeFileSync(filePath, JSON.stringify(state), 'utf8');
    } catch (err) {
      console.error(`[feishu-dedup] 写入失败: ${err}`);
    }
    dirty = false;
  }

  function evictMemory(): void {
    if (memory.size <= MAX_MEMORY_SIZE) return;
    const sorted = [...memory.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, memory.size - MAX_MEMORY_SIZE);
    for (const [id] of toRemove) memory.delete(id);
  }

  loadFromDisk();

  const flushInterval = setInterval(() => saveToDisk(), 30_000);
  flushInterval.unref();

  return {
    isProcessed(messageId: string): boolean {
      const ts = memory.get(messageId);
      if (ts === undefined) return false;
      if (Date.now() - ts >= DEDUP_TTL_MS) {
        memory.delete(messageId);
        return false;
      }
      return true;
    },

    markProcessed(messageId: string, createTime?: string): void {
      memory.set(messageId, Date.now());
      if (createTime) {
        if (!lastProcessedTime || createTime > lastProcessedTime) {
          lastProcessedTime = createTime;
        }
      }
      dirty = true;
      evictMemory();
    },

    getLastProcessedTime(): string | undefined {
      return lastProcessedTime;
    },

    flush(): void {
      saveToDisk();
    },
  };
}
