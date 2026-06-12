/**
 * Learning Store — SQLite 实现
 *
 * 存储工具使用记录、用户反馈、工具调用模式。
 * 复用项目已有的 better-sqlite3 依赖，与 memory 共享同一个 db 文件。
 */

import Database from 'better-sqlite3';
import type {
  ILearningStore,
  IToolUsageRecord,
  IFeedbackRecord,
  IToolPattern,
  IArrowLogRecord,
  IErrorPattern,
} from '../../ports/learning.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  success INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_user ON tool_usage(user_id, tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_usage_conv ON tool_usage(conversation_id);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'correction',
  original TEXT NOT NULL,
  expected TEXT NOT NULL,
  tool_name TEXT,
  rule TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id, type);

CREATE TABLE IF NOT EXISTS tool_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sequence TEXT NOT NULL,
  trigger_desc TEXT NOT NULL DEFAULT '',
  occurrences INTEGER NOT NULL DEFAULT 1,
  promoted INTEGER NOT NULL DEFAULT 0,
  skill_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_tracking (
  skill_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (skill_name, tool_name)
);

CREATE TABLE IF NOT EXISTS arrow_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  outcome TEXT NOT NULL,
  delta TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_arrow_logs_project ON arrow_logs(project_id, target_id);
CREATE INDEX IF NOT EXISTS idx_arrow_logs_ts ON arrow_logs(project_id, ts);

CREATE TABLE IF NOT EXISTS error_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signature TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'internal',
  message_template TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL,
  resolutions TEXT NOT NULL DEFAULT '[]',
  auto_fixed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_patterns_sig ON error_patterns(signature);
CREATE INDEX IF NOT EXISTS idx_error_patterns_freq ON error_patterns(occurrences DESC);
`;

export function createLearningStore(dbPath: string): ILearningStore {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertUsage = db.prepare(`
    INSERT INTO tool_usage (conversation_id, user_id, tool_name, args, result, success, duration_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertFeedback = db.prepare(`
    INSERT INTO feedback (user_id, type, original, expected, tool_name, rule, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPattern = db.prepare(`
    INSERT INTO tool_patterns (name, sequence, trigger_desc, occurrences, promoted, skill_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const updatePatternPromoted = db.prepare(`
    UPDATE tool_patterns SET promoted = 1, skill_name = ? WHERE id = ?
  `);

  const upsertSkillTracking = db.prepare(`
    INSERT INTO skill_tracking (skill_name, tool_name, success_count, last_used_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(skill_name, tool_name) DO UPDATE SET
      success_count = success_count + 1,
      last_used_at = ?
  `);

  const querySkillUseCount = db.prepare(`
    SELECT COALESCE(SUM(success_count), 0) AS total FROM skill_tracking WHERE skill_name = ?
  `);

  const queryDistinctTools = db.prepare(`
    SELECT DISTINCT tool_name FROM tool_usage WHERE user_id = ?
  `);

  const insertArrowLog = db.prepare(`
    INSERT INTO arrow_logs (project_id, target_id, ts, outcome, delta, next_action, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const queryArrowLogs = db.prepare(`
    SELECT * FROM arrow_logs WHERE project_id = ? ORDER BY ts DESC LIMIT ?
  `);

  const upsertErrorPattern = db.prepare(`
    INSERT INTO error_patterns (signature, source, category, message_template, occurrences, last_seen_at, resolutions, auto_fixed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signature) DO UPDATE SET
      occurrences = occurrences + 1,
      last_seen_at = excluded.last_seen_at
  `);

  const queryErrorBySignature = db.prepare(`
    SELECT * FROM error_patterns WHERE signature = ?
  `);

  const queryFrequentErrors = db.prepare(`
    SELECT * FROM error_patterns WHERE occurrences >= ? ORDER BY occurrences DESC LIMIT ?
  `);

  const updateResolution = db.prepare(`
    UPDATE error_patterns SET resolutions = ? WHERE signature = ?
  `);

  return {
    recordUsage(record) {
      insertUsage.run(
        record.conversationId,
        record.userId,
        record.toolName,
        record.args,
        truncate(record.result, 4000),
        record.success ? 1 : 0,
        record.durationMs,
        new Date().toISOString(),
      );
    },

    recordFeedback(record) {
      insertFeedback.run(
        record.userId,
        record.type,
        record.original,
        record.expected,
        record.toolName ?? null,
        record.rule ?? null,
        new Date().toISOString(),
      );
    },

    getUsageHistory(userId, toolName, limit = 20) {
      const rows = db.prepare(`
        SELECT * FROM tool_usage
        WHERE user_id = ? AND tool_name = ?
        ORDER BY created_at DESC LIMIT ?
      `).all(userId, toolName, limit) as any[];

      return rows.map(mapUsageRow);
    },

    getFeedback(userId, type) {
      const sql = type
        ? `SELECT * FROM feedback WHERE user_id = ? AND type = ? ORDER BY created_at DESC`
        : `SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC`;
      const rows = type
        ? db.prepare(sql).all(userId, type) as any[]
        : db.prepare(sql).all(userId) as any[];

      return rows.map(mapFeedbackRow);
    },

    getPreferences(userId, toolName) {
      const sql = toolName
        ? `SELECT rule FROM feedback WHERE user_id = ? AND rule IS NOT NULL AND (tool_name = ? OR tool_name IS NULL) ORDER BY created_at DESC`
        : `SELECT rule FROM feedback WHERE user_id = ? AND rule IS NOT NULL ORDER BY created_at DESC`;
      const rows = toolName
        ? db.prepare(sql).all(userId, toolName) as any[]
        : db.prepare(sql).all(userId) as any[];

      return rows.map((r: any) => r.rule as string);
    },

    getLearningContext(userId, toolNames) {
      const preferences: string[] = [];
      const patterns: string[] = [];

      for (const toolName of toolNames) {
        const prefs = this.getPreferences(userId, toolName);
        preferences.push(...prefs.slice(0, 3));
      }

      const recentPatterns = this.findPatterns(2);
      for (const p of recentPatterns.slice(0, 5)) {
        const seq = JSON.parse(p.sequence) as { tool: string }[];
        const involvedTools = seq.map(s => s.tool);
        if (toolNames.some(t => involvedTools.includes(t))) {
          patterns.push(`模式「${p.name}」: ${p.trigger} (出现 ${p.occurrences} 次)`);
        }
      }

      return { preferences, patterns };
    },

    savePattern(pattern) {
      insertPattern.run(
        pattern.name,
        pattern.sequence,
        pattern.trigger,
        pattern.occurrences,
        pattern.promoted ? 1 : 0,
        pattern.skillName ?? null,
        new Date().toISOString(),
      );
    },

    findPatterns(minOccurrences = 2) {
      const rows = db.prepare(`
        SELECT * FROM tool_patterns
        WHERE occurrences >= ? AND promoted = 0
        ORDER BY occurrences DESC
      `).all(minOccurrences) as any[];

      return rows.map(mapPatternRow);
    },

    promotePattern(patternId, skillName) {
      updatePatternPromoted.run(skillName, patternId);
    },

    recordSkillUse(skillName, toolName) {
      const now = new Date().toISOString();
      upsertSkillTracking.run(skillName, toolName, now, now);
      const row = querySkillUseCount.get(skillName) as { total: number } | undefined;
      return row?.total ?? 0;
    },

    getSkillUseCount(skillName) {
      const row = querySkillUseCount.get(skillName) as { total: number } | undefined;
      return row?.total ?? 0;
    },

    getDistinctToolNames(userId) {
      const rows = queryDistinctTools.all(userId) as { tool_name: string }[];
      return rows.map(r => r.tool_name);
    },

    recordArrowLog(record) {
      insertArrowLog.run(
        record.projectId,
        record.targetId,
        record.ts,
        record.outcome,
        record.delta,
        record.nextAction,
        new Date().toISOString(),
      );
    },

    getArrowLogs(projectId, limit = 100) {
      const rows = queryArrowLogs.all(projectId, limit) as any[];
      return rows.map(mapArrowLogRow);
    },

    recordErrorPattern(pattern) {
      const now = new Date().toISOString();
      upsertErrorPattern.run(
        pattern.signature,
        pattern.source,
        pattern.category,
        pattern.messageTemplate,
        pattern.occurrences,
        pattern.lastSeenAt || now,
        pattern.resolutions || '[]',
        pattern.autoFixed ? 1 : 0,
        now,
      );
    },

    getErrorPattern(signature) {
      const row = queryErrorBySignature.get(signature) as any;
      if (!row) return undefined;
      return mapErrorPatternRow(row);
    },

    getFrequentErrors(minOccurrences = 3, limit = 20) {
      const rows = queryFrequentErrors.all(minOccurrences, limit) as any[];
      return rows.map(mapErrorPatternRow);
    },

    addResolution(signature, resolution) {
      const existing = queryErrorBySignature.get(signature) as any;
      if (!existing) return;
      const resolutions: string[] = JSON.parse(existing.resolutions || '[]');
      resolutions.push(resolution);
      updateResolution.run(JSON.stringify(resolutions), signature);
    },
  };
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function mapUsageRow(r: any): IToolUsageRecord {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    userId: r.user_id,
    toolName: r.tool_name,
    args: r.args,
    result: r.result,
    success: r.success === 1,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}

function mapFeedbackRow(r: any): IFeedbackRecord {
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    original: r.original,
    expected: r.expected,
    toolName: r.tool_name ?? undefined,
    rule: r.rule ?? undefined,
    createdAt: r.created_at,
  };
}

function mapPatternRow(r: any): IToolPattern {
  return {
    id: r.id,
    name: r.name,
    sequence: r.sequence,
    trigger: r.trigger_desc,
    occurrences: r.occurrences,
    promoted: r.promoted === 1,
    skillName: r.skill_name ?? undefined,
    createdAt: r.created_at,
  };
}

function mapArrowLogRow(r: any): IArrowLogRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    targetId: r.target_id,
    ts: r.ts,
    outcome: r.outcome,
    delta: r.delta,
    nextAction: r.next_action,
    createdAt: r.created_at,
  };
}

function mapErrorPatternRow(r: any): IErrorPattern {
  return {
    id: r.id,
    signature: r.signature,
    source: r.source,
    category: r.category,
    messageTemplate: r.message_template,
    occurrences: r.occurrences,
    lastSeenAt: r.last_seen_at,
    resolutions: r.resolutions,
    autoFixed: r.auto_fixed === 1,
    createdAt: r.created_at,
  };
}
