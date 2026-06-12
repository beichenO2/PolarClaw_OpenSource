/**
 * Clock Integration — 工具实现
 *
 * 通过 REST 调用 PolarClock API（端口 15550）。
 * 由 Skill 加载器在启动时注册到 Agent 的工具系统。
 *
 * 认证策略：
 *   - 读操作：走 /api/sync/* 端点，用 X-Sync-Key（服务级），不需要用户 session
 *   - 写操作：走 /api/tasks/* 等端点，用 X-Token（用户级 session token）
 *
 * 实际 Clock API 字段映射（与此前版本的主要差异）：
 *   - 任务标题字段: name（非 title）
 *   - 番茄数字段: pomodor_total / pomodor_completed（非 estimated_pomodoros）
 *   - 计时器状态: GET /api/timer/state（非 /api/timer/status）
 *   - 任务列表: GET /api/tasks（无 status query param，通过 include_archived 控制）
 *   - 完成任务: PUT /api/tasks/:id body { status: "completed" }
 */

import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, SERVICES } from '../_shared/port-discovery.js';

async function getClockBase(): Promise<string> {
  if (process.env.CLOCK_API_URL) return process.env.CLOCK_API_URL;
  return getServiceUrl(SERVICES.CLOCK.name, SERVICES.CLOCK.gateway);
}

let CLOCK_BASE = process.env.CLOCK_API_URL ?? 'http://127.0.0.1:15550';

(async () => {
  try { CLOCK_BASE = await getClockBase(); } catch { /* keep fallback */ }
})();
const CLOCK_SYNC_KEY = process.env.CLOCK_SYNC_KEY ?? '';

function syncHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (CLOCK_SYNC_KEY) h['X-Sync-Key'] = CLOCK_SYNC_KEY;
  return h;
}

function tokenHeaders(token: string): Record<string, string> {
  return {
    'X-Token': token,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function clockFetch<T>(path: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(`${CLOCK_BASE}${path}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

// ── Read-only tools (use sync API, no user token needed) ─────────────────────

/** 聚合查询：通过 sync snapshot 一次拿到用户完整上下文 */
export const clockGetUserContext: IToolHandler = {
  name: 'clock_get_user_context',
  description:
    '一次性获取用户的完整时间管理上下文：番茄状态、今日日程、工作记录。推荐首次交互时调用。' +
    '使用 /api/sync/snapshot，只需 Clock 用户名。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
    },
    required: ['username'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    if (!username) throw new Error('username 必填');

    const snapshot = await clockFetch<Record<string, unknown>>(
      `/api/sync/snapshot?username=${encodeURIComponent(username)}`,
      syncHeaders(),
    );

    if (!snapshot) {
      return { error: 'Clock 服务不可达或用户不存在', username };
    }

    const timer = snapshot.timer as Record<string, unknown> | undefined;
    const schedule = snapshot.schedule as Record<string, unknown> | undefined;
    const today = snapshot.today_summary as Record<string, unknown> | undefined;

    return {
      user_status: snapshot.user_status ?? 'unknown',

      timer: timer ? {
        mode: timer.mode,
        status: timer.status,
        remaining_minutes: timer.remaining_seconds
          ? Math.ceil(Number(timer.remaining_seconds) / 60) : null,
        current_session: timer.current_session,
        total_sessions: timer.total_sessions,
        break_type: timer.break_type,
        exercise_reminder: timer.exercise_reminder_due,
        current_task_id: timer.current_task_id,
      } : null,

      schedule: schedule ? {
        date: schedule.date,
        events: schedule.events ?? [],
      } : null,

      today_summary: today ? {
        pomodoros_completed: today.pomodoros_completed ?? 0,
        work_minutes: today.work_minutes ?? 0,
        sessions: today.sessions ?? [],
      } : null,
    };
  },
};

export const clockGetTimerStatus: IToolHandler = {
  name: 'clock_get_timer_status',
  description: '获取用户的番茄钟当前状态（通过 sync snapshot）。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
    },
    required: ['username'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    const snapshot = await clockFetch<Record<string, unknown>>(
      `/api/sync/snapshot?username=${encodeURIComponent(username)}`,
      syncHeaders(),
    );
    if (!snapshot) return { error: 'Clock 服务不可达', user_status: 'unknown' };
    return {
      user_status: snapshot.user_status,
      timer: snapshot.timer,
    };
  },
};

export const clockGetSchedule: IToolHandler = {
  name: 'clock_get_schedule',
  description: '获取用户今日日程安排（课程、三餐时间）。',
  parameters: {
    type: 'object',
    properties: {
      username: { type: 'string', description: 'Clock 用户名' },
    },
    required: ['username'],
  },
  async handler(args) {
    const username = String(args.username ?? '');
    const snapshot = await clockFetch<Record<string, unknown>>(
      `/api/sync/snapshot?username=${encodeURIComponent(username)}`,
      syncHeaders(),
    );
    if (!snapshot) return { error: 'Clock 服务不可达' };
    return snapshot.schedule ?? { events: [] };
  },
};

// ── Write tools (need user session token) ────────────────────────────────────

export const clockGetTasks: IToolHandler = {
  name: 'clock_get_tasks',
  description: '获取用户的任务列表。需要用户 token（X-Token）。',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Clock 用户 session token' },
      include_archived: { type: 'boolean', description: '是否包含已归档任务' },
    },
    required: ['token'],
  },
  async handler(args) {
    const token = String(args.token ?? '');
    const archived = args.include_archived ? 'true' : 'false';
    const tasks = await clockFetch<Record<string, unknown>>(
      `/api/tasks?include_archived=${archived}`,
      tokenHeaders(token),
    );
    if (!tasks) return { error: '获取任务失败，token 可能无效' };

    const arr = Array.isArray(tasks) ? tasks : Object.values(tasks);
    const active = arr.filter((t: any) => !t.archived);
    return {
      total: arr.length,
      active_count: active.length,
      tasks: active.slice(0, 20).map((t: any) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        deadline: t.deadline,
        tags: t.tags ?? [],
        pomodoros: `${t.pomodor_completed ?? 0}/${t.pomodor_total ?? '?'}`,
        importance: t.importance_axis_position,
        desire: t.desire_axis_position,
      })),
    };
  },
};

export const clockCreateTask: IToolHandler = {
  name: 'clock_create_task',
  description: '在 Clock 中创建新任务。需要用户 token。',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Clock 用户 session token' },
      name: { type: 'string', description: '任务名称（1-500字）' },
      deadline: { type: 'string', description: '截止日期 ISO8601（可选）' },
      pomodor_total: { type: 'number', description: '预计番茄钟数（1-999）' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '标签列表（可选）',
      },
    },
    required: ['token', 'name'],
  },
  async handler(args) {
    const token = String(args.token ?? '');
    try {
      const body: Record<string, unknown> = { name: args.name };
      if (args.deadline) body.deadline = args.deadline;
      if (args.pomodor_total) body.pomodor_total = args.pomodor_total;
      if (args.tags) body.tags = args.tags;

      const res = await fetch(`${CLOCK_BASE}/api/tasks`, {
        method: 'POST',
        headers: tokenHeaders(token),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      return await res.json();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const clockCompleteTask: IToolHandler = {
  name: 'clock_complete_task',
  description: '标记 Clock 任务为完成。需要用户 token。',
  parameters: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Clock 用户 session token' },
      task_id: { type: 'string', description: '任务 ID' },
    },
    required: ['token', 'task_id'],
  },
  async handler(args) {
    const token = String(args.token ?? '');
    const taskId = String(args.task_id ?? '');
    try {
      const res = await fetch(`${CLOCK_BASE}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: tokenHeaders(token),
        body: JSON.stringify({ status: 'completed' }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { error: (err as any).message ?? `HTTP ${res.status}` };
      }
      return await res.json();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  },
};

/** 所有 Clock 工具列表，供 Skill 加载器批量注册 */
export const clockTools: IToolHandler[] = [
  clockGetUserContext,
  clockGetTimerStatus,
  clockGetSchedule,
  clockGetTasks,
  clockCreateTask,
  clockCompleteTask,
];
