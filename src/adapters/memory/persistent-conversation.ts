/**
 * SQLite 持久化对话历史适配器
 *
 * 解决关键差距：进程重启后对话上下文丢失。
 * 实现与 conversation-history.ts 相同的 IConversationHistory 接口，
 * 但底层用 SQLite 存储，进程重启后自动恢复。
 *
 * 设计决策：
 * - 复用现有 better-sqlite3（同步 API，无额外依赖）
 * - 对话消息按 conversation_id 分组，支持 token 预算自动截断
 * - 截断只删 SQLite 行，不影响其他对话
 */

import Database from 'better-sqlite3';
import type { IConversationHistory, IChatMessage } from '../../ports/memory.js';

export interface IPersistentConversationConfig {
  /** SQLite 数据库路径（可与 memory store 共用同一个 .db） */
  dbPath: string;
  /** 每个对话最多保留消息数（默认 100） */
  maxMessages?: number;
  /** 最大 token 估算上限（默认 60000） */
  maxTokens?: number;
}

/** 粗略 token 估算：中文 ~1.5 token/字，英文 ~0.3 token/char */
function estimateTokenCount(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = text.length - cjkChars;
  return Math.ceil(cjkChars * 1.5 + nonCjk * 0.3);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  tool_calls TEXT,
  tool_call_id TEXT,
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_id_seq ON conversations(conversation_id, seq);
`;

export function createPersistentConversation(config: IPersistentConversationConfig): IConversationHistory {
  const maxMessages = config.maxMessages ?? 100;
  const maxTokens = config.maxTokens ?? 60000;

  const db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertMsg = db.prepare(`
    INSERT INTO conversations (conversation_id, role, content, tool_calls, tool_call_id, created_at, seq)
    VALUES (@conversationId, @role, @content, @toolCalls, @toolCallId, @createdAt, @seq)
  `);

  const getMessages = db.prepare(`
    SELECT role, content, tool_calls, tool_call_id, created_at
    FROM conversations
    WHERE conversation_id = @conversationId
    ORDER BY seq ASC
  `);

  const getMessageCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM conversations WHERE conversation_id = @conversationId
  `);

  const getMaxSeq = db.prepare(`
    SELECT COALESCE(MAX(seq), 0) as maxSeq FROM conversations WHERE conversation_id = @conversationId
  `);

  const deleteOldest = db.prepare(`
    DELETE FROM conversations
    WHERE id IN (
      SELECT id FROM conversations
      WHERE conversation_id = @conversationId
      ORDER BY seq ASC
      LIMIT @count
    )
  `);

  const deleteAll = db.prepare(`
    DELETE FROM conversations WHERE conversation_id = @conversationId
  `);

  const listConvs = db.prepare(`
    SELECT conversation_id,
           COUNT(*) as msg_count,
           MAX(created_at) as last_at,
           (SELECT content FROM conversations c2
            WHERE c2.conversation_id = conversations.conversation_id
              AND c2.role IN ('user','assistant')
            ORDER BY c2.seq DESC LIMIT 1) as preview
    FROM conversations
    GROUP BY conversation_id
    ORDER BY MAX(created_at) DESC
    LIMIT @limit
  `);

  /** 将 DB 行转为 IChatMessage */
  function rowToMessage(row: {
    role: string; content: string;
    tool_calls: string | null; tool_call_id: string | null;
    created_at: string;
  }): IChatMessage {
    const msg: IChatMessage = {
      role: row.role as IChatMessage['role'],
      content: row.content,
      timestamp: new Date(row.created_at),
    };
    if (row.tool_calls) {
      try { msg.toolCalls = JSON.parse(row.tool_calls); } catch { /* ignore */ }
    }
    if (row.tool_call_id) msg.toolCallId = row.tool_call_id;
    return msg;
  }

  /** 截断超出预算的旧消息 */
  function trimIfNeeded(conversationId: string): void {
    const { cnt } = getMessageCount.get({ conversationId }) as { cnt: number };

    // 消息数量截断
    if (cnt > maxMessages) {
      deleteOldest.run({ conversationId, count: cnt - maxMessages });
    }

    // Token 预算截断
    const rows = getMessages.all({ conversationId }) as Array<{
      role: string; content: string;
      tool_calls: string | null; tool_call_id: string | null;
      created_at: string;
    }>;

    let totalTokens = 0;
    for (const r of rows) totalTokens += estimateTokenCount(r.content);

    if (totalTokens > maxTokens && rows.length > 1) {
      let excess = totalTokens - maxTokens;
      let toDelete = 0;
      for (const r of rows) {
        if (excess <= 0) break;
        excess -= estimateTokenCount(r.content);
        toDelete++;
      }
      if (toDelete > 0) {
        deleteOldest.run({ conversationId, count: toDelete });
      }
    }
  }

  return {
    append(conversationId, message) {
      const { maxSeq } = getMaxSeq.get({ conversationId }) as { maxSeq: number };

      insertMsg.run({
        conversationId,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        toolCallId: message.toolCallId ?? null,
        createdAt: (message.timestamp ?? new Date()).toISOString(),
        seq: maxSeq + 1,
      });

      trimIfNeeded(conversationId);
    },

    getHistory(conversationId, options = {}) {
      const rows = getMessages.all({ conversationId }) as Array<{
        role: string; content: string;
        tool_calls: string | null; tool_call_id: string | null;
        created_at: string;
      }>;

      const msgs = rows.map(rowToMessage);

      if (options.limit && options.fromLatest) {
        return msgs.slice(-options.limit);
      }
      if (options.limit) {
        return msgs.slice(0, options.limit);
      }
      return msgs;
    },

    clear(conversationId) {
      deleteAll.run({ conversationId });
    },

    estimateTokens(conversationId) {
      const rows = getMessages.all({ conversationId }) as Array<{
        role: string; content: string;
        tool_calls: string | null; tool_call_id: string | null;
        created_at: string;
      }>;
      return rows.reduce((sum, r) => sum + estimateTokenCount(r.content), 0);
    },

    listConversations(limit = 50) {
      const rows = listConvs.all({ limit }) as Array<{
        conversation_id: string;
        msg_count: number;
        last_at: string;
        preview: string | null;
      }>;
      return rows.map(r => ({
        conversationId: r.conversation_id,
        messageCount: r.msg_count,
        lastMessageAt: r.last_at,
        preview: (r.preview ?? '')
          .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
          .trim()
          .slice(0, 120),
      }));
    },
  };
}
