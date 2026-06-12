/**
 * SessionMemory — 运行时记忆管理
 *
 * 参考 MemGPT Summarizer 实现，提供两种压缩模式：
 * - STATIC_MESSAGE_BUFFER：保留最近 N 条消息
 * - PARTIAL_EVICT_MESSAGE_BUFFER：按百分比驱逐并生成摘要
 *
 * 核心能力：
 * - compressForNextTurn：将当前会话压缩为 ≤20K 字符的摘要，供下次对话注入
 * - injectFromPrevious：反序列化压缩结果注入上下文
 * - fetchLongTermMemory：调用 PolarMemory /api/blocks/search 获取长期记忆 Block
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { IChatMessage } from '../ports/memory.js';

// ─── 类型定义 ───

/** PolarMemory Block 结构（与 PolarMemory/src/block.ts 对齐） */
export type BlockType = 'entity' | 'preference' | 'fact' | 'goal' | 'relationship' | 'event' | 'concept' | 'procedure' | 'emotion' | 'decision' | 'skill' | 'context' | 'meta';
export type BlockSource = 'conversation' | 'wiki' | 'agent_written' | 'user_explicit';

export interface Block {
  label: string;
  value: string;
  tokens: number;
  read_only: boolean;
  source_wiki: string;
  created_at: string;
  updated_at: string;
  type?: BlockType;
  temporal?: {
    valid_from?: string;
    valid_until?: string;
    recurrence?: string;
  };
  confidence?: number;
  source?: BlockSource;
  entity_refs?: string[];
}

/** 压缩后的情景记忆 */
export interface CompressedMemory {
  /** 摘要文本 */
  summary: string;
  /** 被压缩的原始消息数量 */
  originalCount: number;
  /** 压缩时间戳 */
  compressedAt: string;
}

/** 会话记忆结构 */
export interface SessionMemory {
  /** 当前轮次的完整消息（未压缩） */
  working: IChatMessage[];
  /** 历史轮次的压缩摘要 */
  episodic: CompressedMemory[];
  /** 核心事实（用户画像、关键决策等） */
  coreFacts: string;
  /** 从 PolarMemory 获取的长期记忆 Block */
  longTermBlocks: Block[];
}

/** 压缩模式（对齐 MemGPT SummarizationMode） */
export enum CompressionMode {
  /** 保留最近 N 条消息，其余驱逐 */
  STATIC_MESSAGE_BUFFER = 'static_message_buffer',
  /** 按百分比驱逐，生成摘要插入上下文 */
  PARTIAL_EVICT_MESSAGE_BUFFER = 'partial_evict_message_buffer',
}

/** SessionMemoryManager 配置 */
export interface ISessionMemoryManagerConfig {
  /** 压缩模式（默认 STATIC_MESSAGE_BUFFER） */
  mode?: CompressionMode;
  /** STATIC 模式：消息缓冲区上限（默认 20） */
  messageBufferLimit?: number;
  /** STATIC 模式：最少保留消息数（默认 6） */
  messageBufferMin?: number;
  /** PARTIAL_EVICT 模式：驱逐百分比（默认 0.3） */
  partialEvictPercentage?: number;
  /** 压缩输出最大字符数（默认 20000 = 20K） */
  maxCompressedChars?: number;
  /** PolarMemory API 基础 URL（默认 http://localhost:3100） */
  polarMemoryBaseUrl?: string;
  /** fetchLongTermMemory 返回的最大 Block 数（默认 5） */
  maxLongTermBlocks?: number;
  /** LLM 摘要函数（可选，不提供则使用规则压缩） */
  summarize?: (text: string) => Promise<string>;
  /** SQLite path for episodic persistence */
  dbPath?: string;
  /** Max in-memory sessions (default 50) */
  maxSessions?: number;
}

// ─── 工具函数 ───

/** 粗略 token 估算：中文 ~1.5 token/字，英文 ~0.3 token/char */
function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = text.length - cjkChars;
  return Math.ceil(cjkChars * 1.5 + nonCjk * 0.3);
}

/** 将消息列表格式化为可读文本（参考 MemGPT format_transcript） */
function formatMessages(messages: IChatMessage[]): string {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      let content = m.content;
      if (m.role === 'assistant' && m.toolCalls?.length) {
        const toolNames = m.toolCalls.map(tc => tc.function.name).join(', ');
        content = `${content} -> [工具调用: ${toolNames}]`;
      }
      return `[${m.role}] ${content}`;
    })
    .join('\n');
}

/** 规则压缩：提取关键事实生成摘要（无需 LLM） */
function ruleBasedCompress(messages: IChatMessage[]): string {
  const facts: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      facts.push(`用户: ${m.content.slice(0, 200)}`);
    } else if (m.role === 'assistant') {
      if (m.toolCalls?.length) {
        const toolNames = m.toolCalls.map(tc => tc.function.name).join(', ');
        facts.push(`助手调用工具: ${toolNames}`);
      }
      if (m.content) {
        facts.push(`助手: ${m.content.slice(0, 200)}`);
      }
    } else if (m.role === 'tool') {
      facts.push(`工具结果: ${m.content.slice(0, 100)}`);
    }
  }
  return facts.join('\n');
}

/** 中间截断（参考 MemGPT middle_truncate_text） */
function middleTruncate(text: string, budgetChars: number): string {
  if (text.length <= budgetChars) return text;
  const headLen = Math.floor(budgetChars * 0.3);
  const tailLen = Math.floor(budgetChars * 0.3);
  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);
  const dropped = text.length - headLen - tailLen;
  return `${head}\n\n[...已截断: 跳过中间 ${dropped} 字符...]\n\n${tail}`;
}

// ─── 序列化/反序列化 ───

interface SerializedSessionMemory {
  episodic: CompressedMemory[];
  coreFacts: string;
  longTermBlocks: Block[];
  compressedAt: string;
}

function serializeSessionMemory(memory: SessionMemory): string {
  const payload: SerializedSessionMemory = {
    episodic: memory.episodic,
    coreFacts: memory.coreFacts,
    longTermBlocks: memory.longTermBlocks,
    compressedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

function deserializeSessionMemory(json: string): SerializedSessionMemory | null {
  try {
    return JSON.parse(json) as SerializedSessionMemory;
  } catch {
    return null;
  }
}

// ─── SessionMemoryManager 类 ───

export class SessionMemoryManager {
  private readonly mode: CompressionMode;
  private readonly messageBufferLimit: number;
  private readonly messageBufferMin: number;
  private readonly partialEvictPercentage: number;
  private readonly maxCompressedChars: number;
  private readonly polarMemoryBaseUrl: string;
  private readonly maxLongTermBlocks: number;
  private readonly summarize?: (text: string) => Promise<string>;

  /** 按 conversationId 维护的会话记忆状态 */
  private readonly sessions = new Map<string, SessionMemory>();

  /** Episodic persistence SQLite DB */
  private episodicDb: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly maxSessions: number;

  /** LRU access order tracking */
  private accessOrder: string[] = [];

  constructor(config: ISessionMemoryManagerConfig = {}) {
    this.mode = config.mode ?? CompressionMode.STATIC_MESSAGE_BUFFER;
    this.messageBufferLimit = config.messageBufferLimit ?? 20;
    this.messageBufferMin = config.messageBufferMin ?? 6;
    this.partialEvictPercentage = config.partialEvictPercentage ?? 0.3;
    this.maxCompressedChars = config.maxCompressedChars ?? 20000;
    this.polarMemoryBaseUrl = config.polarMemoryBaseUrl ?? 'http://localhost:3100';
    this.maxLongTermBlocks = config.maxLongTermBlocks ?? 5;
    this.summarize = config.summarize;
    const explicitDbPath = config.dbPath ?? (process.env.POLARCLAW_DATA_DIR ? join(process.env.POLARCLAW_DATA_DIR, 'session_episodic.db') : null);
    this.dbPath = explicitDbPath ?? '';
    this.maxSessions = config.maxSessions ?? 50;
    if (explicitDbPath) {
      this.initEpisodicDb();
    }
  }

  /** 获取或创建会话记忆（带 LRU 和 DB 加载） */
  getOrCreateSession(convId: string): SessionMemory {
    let session = this.sessions.get(convId);
    if (!session) {
      // Try loading from DB first
      session = this.loadSessionFromDb(convId) ?? undefined;
      if (session) {
        session.working = []; // working memory is always fresh
      } else {
        session = {
          working: [],
          episodic: [],
          coreFacts: '',
          longTermBlocks: [],
        };
      }
      this.sessions.set(convId, session);
    }
    // Update LRU access order
    this.accessOrder = this.accessOrder.filter(id => id !== convId);
    this.accessOrder.push(convId);

    // LRU eviction if over capacity
    if (this.sessions.size > this.maxSessions) {
      const lruConvId = this.accessOrder.shift();
      if (lruConvId && lruConvId !== convId) {
        try { this.saveSessionToDb(lruConvId); } catch { /* ignore */ }
        this.sessions.delete(lruConvId);
      }
    }
    return session;
  }

  /** 更新会话的 working memory（当前轮消息） */
  updateWorkingMemory(convId: string, messages: IChatMessage[]): void {
    const session = this.getOrCreateSession(convId);
    session.working = messages;
  }

  /** 更新会话的 coreFacts */
  updateCoreFacts(convId: string, facts: string): void {
    const session = this.getOrCreateSession(convId);
    session.coreFacts = facts;
  }

  /**
   * compressForNextTurn — 将当前会话压缩为 ≤20K 字符的 JSON 字符串
   *
   * 两种模式：
   * - STATIC_MESSAGE_BUFFER：保留最近 messageBufferMin 条消息，其余生成摘要
   * - PARTIAL_EVICT_MESSAGE_BUFFER：按百分比驱逐，摘要插入上下文
   *
   * @returns 压缩后的 JSON 字符串，可直接传给 injectFromPrevious
   */
  async compressForNextTurn(convId: string, userId?: string): Promise<string> {
    const session = this.getOrCreateSession(convId);
    const messages = session.working;

    if (messages.length === 0) {
      return serializeSessionMemory(session);
    }

    let compressed: CompressedMemory;

    if (this.mode === CompressionMode.STATIC_MESSAGE_BUFFER) {
      compressed = await this.staticBufferCompress(messages);
    } else {
      compressed = await this.partialEvictCompress(messages);
    }

    // 追加到情景记忆（保留最近 10 条，防止累积超出预算）
    session.episodic.push(compressed);
    if (session.episodic.length > 10) {
      session.episodic = session.episodic.slice(-10);
    }

    // 保留 working 中的最近消息
    const retainCount = this.mode === CompressionMode.STATIC_MESSAGE_BUFFER
      ? this.messageBufferMin
      : Math.ceil(messages.length * (1 - this.partialEvictPercentage));
    session.working = messages.slice(-retainCount);

    // 序列化并确保不超过 20K (hard limit: 50 iterations to prevent infinite loop)
    let result = serializeSessionMemory(session);
    let shrinkAttempts = 0;
    while (result.length > this.maxCompressedChars && shrinkAttempts < 50) {
      shrinkAttempts++;
      const prevLen = result.length;

      if (session.episodic.length > 1) {
        const oldest = session.episodic[0];
        if (oldest && oldest.summary.length > 100) {
          oldest.summary = middleTruncate(oldest.summary, Math.floor(oldest.summary.length * 0.5));
        } else {
          session.episodic.shift();
        }
      } else {
        const only = session.episodic[0];
        if (only) {
          const budget = this.maxCompressedChars - 200;
          only.summary = middleTruncate(only.summary, Math.max(100, budget));
        }
      }
      result = serializeSessionMemory(session);

      if (result.length >= prevLen) break;
    }

    // Persist to SQLite after compression
    try { this.saveSessionToDb(convId); } catch { /* ignore */ }

    // Auto-archive the compressed summary into PolarMemory's long-term store so
    // conversation memory accumulates across sessions (user-isolated). Only when
    // a real userId is provided; fire-and-forget so it never blocks the turn.
    if (userId && userId !== 'anonymous') {
      void this.archiveToPolarMemory(compressed, convId, userId);
    }

    return result;
  }

  /**
   * archiveToPolarMemory — persist a compressed conversation summary as a
   * long-term Block (source=conversation, user-isolated) so memory accumulates
   * across sessions ("记忆厚度"). Optional LLM refine via config.summarize.
   * Fire-and-forget: failures are swallowed since the SQLite episodic store is
   * the primary record.
   */
  private async archiveToPolarMemory(compressed: CompressedMemory, convId: string, userId: string): Promise<void> {
    try {
      const raw = compressed.summary?.trim();
      if (!raw) return;
      const value = this.summarize ? await this.summarize(raw) : raw;
      await fetch(`${this.polarMemoryBaseUrl}/api/blocks/upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block: {
            label: `conv-${convId}-${compressed.compressedAt}`,
            value: value.slice(0, 4000),
            tokens: Math.ceil(value.length / 4),
            read_only: false,
            source_wiki: '',
            created_at: compressed.compressedAt,
            updated_at: compressed.compressedAt,
            type: 'context',
            source: 'conversation',
            user_id: userId,
            confidence: 0.7,
          },
        }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // fire-and-forget — never fail the turn on archival
    }
  }

  /**
   * injectFromPrevious — 将上轮压缩结果注入当前会话
   *
   * 将压缩的情景记忆和核心事实作为 system 消息注入对话上下文
   */
  async injectFromPrevious(convId: string, compressed: string): Promise<void> {
    const deserialized = deserializeSessionMemory(compressed);
    if (!deserialized) return;

    const session = this.getOrCreateSession(convId);
    session.episodic = deserialized.episodic;
    session.coreFacts = deserialized.coreFacts;
    session.longTermBlocks = deserialized.longTermBlocks;
  }

  /**
   * fetchLongTermMemory — 调用 PolarMemory /api/blocks/search 获取长期记忆 Block
   *
   * 优雅降级：API 不可用时返回空数组。
   * userId 为空或为 anonymous 时不请求（避免未过滤的 PolarMemory 搜索）。
   * 应用时间衰减：基于创建/更新时间计算衰减因子
   */
  async fetchLongTermMemory(query: string, userId?: string): Promise<Block[]> {
    const u = userId?.trim();
    if (!u || u === 'anonymous') {
      return [];
    }
    try {
      const response = await fetch(`${this.polarMemoryBaseUrl}/api/blocks/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          user: u,
          top_k: this.maxLongTermBlocks,
          temporal_valid: true,
        }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        console.error(`[SessionMemory] PolarMemory API returned ${response.status}`);
        return [];
      }

      const data = await response.json() as { blocks: Block[]; total: number };
      const blocks = data.blocks ?? [];
      // Apply temporal decay
      const halfLifeDays = 30;
      const now = Date.now();
      return blocks
        .map(b => {
          const ageDays = (now - new Date(b.created_at || b.updated_at).getTime()) / (1000 * 60 * 60 * 24);
          const decayFactor = Math.exp(-ageDays / halfLifeDays);
          const baseScore = b.confidence ?? 1.0;
          return { block: b, score: baseScore * decayFactor };
        })
        .sort((a, b) => b.score - a.score)
        .map(x => x.block);
    } catch (err) {
      console.error('[SessionMemory] fetchLongTermMemory failed:', err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  /**
   * buildMemoryInjection — 构建注入到 LLM 上下文的记忆文本
   *
   * 将情景记忆、核心事实、长期记忆 Block 合并为结构化文本
   */
  buildMemoryInjection(convId: string): string {
    const session = this.getOrCreateSession(convId);
    const parts: string[] = [];

    if (session.episodic.length > 0) {
      parts.push('## 历史对话摘要');
      for (const ep of session.episodic) {
        parts.push(`- [${ep.compressedAt}] (${ep.originalCount}条消息) ${ep.summary.slice(0, 500)}`);
      }
    }

    if (session.coreFacts) {
      parts.push('## 核心事实');
      parts.push(session.coreFacts);
    }

    if (session.longTermBlocks.length > 0) {
      parts.push('## 长期记忆');
      for (const block of session.longTermBlocks) {
        parts.push(`### ${block.label}`);
        parts.push(block.value.slice(0, 800));
      }
    }

    return parts.length > 0 ? parts.join('\n') : '';
  }

  /** 清除会话记忆 */
  clearSession(convId: string): void {
    this.sessions.delete(convId);
    // Also remove from DB
    try {
      this.episodicDb?.prepare('DELETE FROM session_episodic WHERE conversation_id = ?').run(convId);
    } catch { /* ignore */ }
    this.accessOrder = this.accessOrder.filter(id => id !== convId);
  }

  // ─── 私有方法 ───

  /** Initialize the episodic persistence SQLite database */
  private initEpisodicDb(): void {
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    this.episodicDb = new Database(this.dbPath);
    this.episodicDb.exec(`
      CREATE TABLE IF NOT EXISTS session_episodic (
        conversation_id TEXT PRIMARY KEY,
        episodic_json TEXT,
        core_facts TEXT,
        long_term_json TEXT,
        last_accessed TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this.episodicDb.exec(`
      CREATE TABLE IF NOT EXISTS task_contracts (
        conversation_id TEXT PRIMARY KEY,
        contract_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  /** Persist session's episodic, coreFacts, longTermBlocks to SQLite */
  private saveSessionToDb(convId: string): void {
    if (!this.episodicDb) return;
    const session = this.sessions.get(convId);
    if (!session) return;
    const now = new Date().toISOString();
    this.episodicDb.prepare(`
      INSERT INTO session_episodic (conversation_id, episodic_json, core_facts, long_term_json, last_accessed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        episodic_json = excluded.episodic_json,
        core_facts = excluded.core_facts,
        long_term_json = excluded.long_term_json,
        last_accessed = excluded.last_accessed,
        updated_at = excluded.updated_at
    `).run(
      convId,
      JSON.stringify(session.episodic),
      session.coreFacts,
      JSON.stringify(session.longTermBlocks),
      now,
      now,
    );
  }

  /** Load session from SQLite; returns null if not found */
  private loadSessionFromDb(convId: string): SessionMemory | null {
    if (!this.episodicDb) return null;
    const row = this.episodicDb.prepare(
      'SELECT episodic_json, core_facts, long_term_json FROM session_episodic WHERE conversation_id = ?'
    ).get(convId) as { episodic_json: string; core_facts: string; long_term_json: string } | undefined;
    if (!row) return null;

    try {
      return {
        working: [],
        episodic: JSON.parse(row.episodic_json) as CompressedMemory[],
        coreFacts: row.core_facts || '',
        longTermBlocks: JSON.parse(row.long_term_json) as Block[],
      };
    } catch {
      return null;
    }
  }

  /** STATIC_MESSAGE_BUFFER 压缩：保留最近 N 条，其余生成摘要 */
  private async staticBufferCompress(messages: IChatMessage[]): Promise<CompressedMemory> {
    if (messages.length <= this.messageBufferLimit) {
      return {
        summary: formatMessages(messages),
        originalCount: messages.length,
        compressedAt: new Date().toISOString(),
      };
    }

    const evicted = messages.slice(0, -this.messageBufferMin);
    const summary = await this.generateSummary(evicted);

    return {
      summary,
      originalCount: evicted.length,
      compressedAt: new Date().toISOString(),
    };
  }

  /** PARTIAL_EVICT_MESSAGE_BUFFER 压缩：按百分比驱逐 */
  private async partialEvictCompress(messages: IChatMessage[]): Promise<CompressedMemory> {
    const total = messages.length;
    const evictCount = Math.floor(total * this.partialEvictPercentage);

    if (evictCount <= 0 || total <= 2) {
      return {
        summary: formatMessages(messages),
        originalCount: messages.length,
        compressedAt: new Date().toISOString(),
      };
    }

    // 找到驱逐边界：确保在 assistant 消息处切割（参考 MemGPT）
    let cutIndex = evictCount;
    for (let i = cutIndex; i < total; i++) {
      if (messages[i]?.role === 'assistant') {
        cutIndex = i;
        break;
      }
    }

    const evicted = messages.slice(0, cutIndex);
    const summary = await this.generateSummary(evicted);

    return {
      summary,
      originalCount: evicted.length,
      compressedAt: new Date().toISOString(),
    };
  }

  /** 生成摘要：优先使用 LLM，否则使用规则压缩 */
  private async generateSummary(messages: IChatMessage[]): Promise<string> {
    if (this.summarize) {
      try {
        const transcript = formatMessages(messages);
        return await this.summarize(transcript);
      } catch (err) {
        console.error('[SessionMemory] LLM 摘要失败，降级为规则压缩:', err);
      }
    }
    return ruleBasedCompress(messages);
  }

  /** Save a TaskContract to SQLite */
  saveContract(convId: string, contractJson: string): void {
    if (!this.episodicDb) return;
    const now = new Date().toISOString();
    this.episodicDb.prepare(`
      INSERT INTO task_contracts (conversation_id, contract_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        contract_json = excluded.contract_json,
        updated_at = excluded.updated_at
    `).run(convId, contractJson, now);
  }

  /** Load a TaskContract from SQLite; returns null if not found */
  loadContract(convId: string): string | null {
    if (!this.episodicDb) return null;
    const row = this.episodicDb.prepare(
      'SELECT contract_json FROM task_contracts WHERE conversation_id = ?'
    ).get(convId) as { contract_json: string } | undefined;
    return row?.contract_json ?? null;
  }

  /** Close the episodic DB, saving all sessions first */
  close(): void {
    for (const convId of this.sessions.keys()) {
      try { this.saveSessionToDb(convId); } catch { /* ignore */ }
    }
    this.episodicDb?.close();
  }
}
