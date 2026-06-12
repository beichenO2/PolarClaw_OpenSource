/**
 * Schedule Bridge — 消费 Clock /schedule/today API，基于用户日程触发关怀
 *
 * 定期拉取 Clock 的 /schedule/today 接口，解析日程块和三餐窗口，
 * 在日程开始前 10 分钟和结束后触发 CareEngine 关怀。
 */

import type { IProactiveEngine } from '../../ports/proactive.js';

export interface IScheduleBridgeConfig {
  clockBaseUrl: string;
  username: string;
  /** Clock 认证 token（可选） */
  clockToken?: string;
  /** 拉取间隔 ms（默认 5 分钟） */
  pollIntervalMs?: number;
  /** 日程开始前多少 ms 触发提醒（默认 10 分钟） */
  preAlertMs?: number;
}

export interface IScheduleBridge {
  start(): void;
  stop(): void;
}

interface ScheduleBlock {
  name: string;
  start_hhmm: string;
  end_hhmm: string;
  type: 'rule' | 'meal';
}

/**
 * Parse Clock /schedule/today response into normalized blocks.
 */
function parseScheduleResponse(data: unknown): ScheduleBlock[] {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;

  const blocks: ScheduleBlock[] = [];

  const rules = d.rules ?? d.schedule_blocks;
  if (Array.isArray(rules)) {
    for (const r of rules) {
      if (r && typeof r === 'object' && 'start_hhmm' in r && 'end_hhmm' in r) {
        blocks.push({
          name: String((r as Record<string, unknown>).name ?? '日程'),
          start_hhmm: String((r as Record<string, unknown>).start_hhmm),
          end_hhmm: String((r as Record<string, unknown>).end_hhmm),
          type: 'rule',
        });
      }
    }
  }

  const meals = d.meal_windows ?? d.meals;
  if (Array.isArray(meals)) {
    for (const m of meals) {
      if (m && typeof m === 'object' && 'start_hhmm' in m) {
        blocks.push({
          name: String((m as Record<string, unknown>).name ?? '用餐'),
          start_hhmm: String((m as Record<string, unknown>).start_hhmm),
          end_hhmm: String((m as Record<string, unknown>).end_hhmm ?? (m as Record<string, unknown>).start_hhmm),
          type: 'meal',
        });
      }
    }
  }

  return blocks;
}

function hhmmToMs(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return ((h ?? 0) * 60 + (m ?? 0)) * 60_000;
}

function todayMs(): number {
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) * 60_000 + now.getSeconds() * 1000;
}

export function createScheduleBridge(
  config: IScheduleBridgeConfig,
  careEngine: IProactiveEngine,
): IScheduleBridge {
  const pollInterval = config.pollIntervalMs ?? 5 * 60_000;
  const preAlertMs = config.preAlertMs ?? 10 * 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const firedAlerts = new Set<string>();

  function resetDailyAlerts(): void {
    firedAlerts.clear();
  }

  async function fetchTodaySchedule(): Promise<ScheduleBlock[]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (config.clockToken) headers['X-Token'] = config.clockToken;

    try {
      const res = await fetch(
        `${config.clockBaseUrl}/schedule/today`,
        { headers, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return parseScheduleResponse(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('Unexpected token') && !msg.includes('abort') && !msg.includes('ECONNREFUSED')) {
        console.error(`[ScheduleBridge] 拉取日程失败: ${msg}`);
      }
      return [];
    }
  }

  async function checkSchedule(): Promise<void> {
    const blocks = await fetchTodaySchedule();
    if (blocks.length === 0) return;

    const nowMs = todayMs();

    for (const block of blocks) {
      const startMs = hhmmToMs(block.start_hhmm);
      const endMs = hhmmToMs(block.end_hhmm);

      const preAlertKey = `pre:${block.name}:${block.start_hhmm}`;
      const timeUntilStart = startMs - nowMs;
      if (timeUntilStart > 0 && timeUntilStart <= preAlertMs && !firedAlerts.has(preAlertKey)) {
        firedAlerts.add(preAlertKey);
        const minutesLeft = Math.round(timeUntilStart / 60_000);

        const prompt = block.type === 'meal'
          ? `[系统提示：${block.name}时间快到了（${minutesLeft}分钟后）。自然地提醒用户注意用餐时间。]`
          : `[系统提示：用户的日程「${block.name}」将在 ${minutesLeft} 分钟后开始（${block.start_hhmm}）。请自然地提醒用户准备。]`;

        careEngine.trigger({
          type: 'event',
          userId: config.username,
          reason: 'schedule-pre-alert',
          context: { block, minutesLeft },
        }).catch(err => console.error('[ScheduleBridge] trigger 失败:', err));

        console.error(`[ScheduleBridge] 预提醒: ${block.name} (${minutesLeft}min)`);
        void prompt;
      }

      const postAlertKey = `post:${block.name}:${block.end_hhmm}`;
      const timeSinceEnd = nowMs - endMs;
      if (timeSinceEnd >= 0 && timeSinceEnd < pollInterval && !firedAlerts.has(postAlertKey)) {
        firedAlerts.add(postAlertKey);

        careEngine.trigger({
          type: 'event',
          userId: config.username,
          reason: 'schedule-ended',
          context: { block },
        }).catch(err => console.error('[ScheduleBridge] trigger 失败:', err));

        console.error(`[ScheduleBridge] 结束提醒: ${block.name}`);
      }
    }
  }

  let lastResetDate = '';

  async function poll(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastResetDate) {
      resetDailyAlerts();
      lastResetDate = today;
    }
    await checkSchedule();
  }

  return {
    start() {
      stopped = false;
      timer = setInterval(() => void poll(), pollInterval);
      void poll();
      console.error(`[ScheduleBridge] 已启动, 轮询间隔 ${pollInterval / 1000}s, 用户: ${config.username}`);
    },

    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.error('[ScheduleBridge] 已停止');
    },
  };
}
