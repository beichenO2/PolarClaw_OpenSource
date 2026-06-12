/**
 * Clock SSE Bridge — 订阅 PolarClock 实时事件流，桥接到 CareEngine
 *
 * 连接 Clock 的 /api/sync/events SSE 端点，监听 timer_change / session_complete
 * 事件，自动调用 CareEngine.trigger() 触发主动关怀。
 *
 * 重连策略：指数退避（1s → 2s → 4s → … → 30s 上限）
 */

import type { IProactiveEngine } from '../../ports/proactive.js';

export interface IClockSseBridgeConfig {
  clockBaseUrl: string;
  syncKey?: string;
  /** Clock 用户名列表（桥接为每个用户建立独立 SSE 连接） */
  usernames: string[];
  /** 初始重连延迟 ms（默认 1000） */
  reconnectBaseMs?: number;
  /** 最大重连延迟 ms（默认 30000） */
  reconnectMaxMs?: number;
}

export interface IClockSseBridge {
  start(): void;
  stop(): void;
}

export function createClockSseBridge(
  config: IClockSseBridgeConfig,
  careEngine: IProactiveEngine,
): IClockSseBridge {
  const baseMs = config.reconnectBaseMs ?? 1000;
  const maxMs = config.reconnectMaxMs ?? 30000;

  const controllers = new Map<string, AbortController>();
  let stopped = false;

  async function connectUser(username: string, attempt = 0): Promise<void> {
    if (stopped) return;

    const ctl = new AbortController();
    controllers.set(username, ctl);

    const url = `${config.clockBaseUrl}/api/sync/events?username=${encodeURIComponent(username)}`;
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (config.syncKey) headers['X-Sync-Key'] = config.syncKey;

    let lastStatus: string | null = null;

    try {
      const res = await fetch(url, { headers, signal: ctl.signal });

      if (!res.ok || !res.body) {
        throw new Error(`Clock SSE HTTP ${res.status}`);
      }

      console.error(`[ClockSSE] 已连接: ${username}`);
      attempt = 0;

      const decoder = new TextDecoder();
      let buffer = '';

      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        if (stopped) break;

        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let eventType = '';
        let dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          } else if (line === '' && eventType && dataLines.length > 0) {
            handleEvent(username, eventType, dataLines.join('\n'), lastStatus);
            try {
              const parsed = JSON.parse(dataLines.join('\n'));
              lastStatus = parsed.user_status ?? lastStatus;
            } catch { /* keep previous */ }
            eventType = '';
            dataLines = [];
          } else if (line.startsWith(':')) {
            // keepalive comment — ignore
          }
        }
      }
    } catch (err) {
      if (stopped) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) return;
      if (attempt <= 3) {
        console.error(`[ClockSSE] ${username} 断开: ${msg}`);
      }
    }

    if (stopped) return;

    const nextAttempt = attempt + 1;
    const delay = Math.min(baseMs * 2 ** attempt, maxMs);

    if (nextAttempt <= 3) {
      console.error(`[ClockSSE] ${username} 将在 ${delay / 1000}s 后重连 (attempt ${nextAttempt})`);
    } else if (nextAttempt === 4) {
      console.error(`[ClockSSE] ${username} Clock 服务不可用，后续重连静默进行`);
    }

    if (nextAttempt > 100) {
      console.error(`[ClockSSE] ${username} 连续 ${nextAttempt} 次失败，停止重连`);
      return;
    }

    await sleep(delay);
    if (!stopped) connectUser(username, nextAttempt);
  }

  function handleEvent(
    username: string,
    eventType: string,
    rawData: string,
    prevStatus: string | null,
  ): void {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawData);
    } catch {
      return;
    }

    if (eventType === 'snapshot') {
      console.error(`[ClockSSE] ${username} 初始状态: ${data.user_status}`);
      return;
    }

    const newStatus = data.user_status as string | undefined;

    if (eventType === 'timer_change') {
      // working/exercising/meditating → idle/resting = session just ended
      const wasActive = prevStatus === 'working' || prevStatus === 'exercising' || prevStatus === 'meditating';
      const nowDone = newStatus === 'idle' || newStatus === 'resting';

      if (wasActive && nowDone) {
        console.error(`[ClockSSE] ${username} 番茄钟结束 (${prevStatus} → ${newStatus})`);
        careEngine.trigger({
          type: 'event',
          userId: username,
          reason: 'timer-complete',
          context: { from: prevStatus, to: newStatus, timer: data.timer },
        }).catch(err => {
          console.error(`[ClockSSE] trigger 失败:`, err);
        });
      }
    }

    if (eventType === 'session_complete') {
      console.error(`[ClockSSE] ${username} session 完成`);
      careEngine.trigger({
        type: 'event',
        userId: username,
        reason: 'timer-complete',
        context: data,
      }).catch(err => {
        console.error(`[ClockSSE] trigger 失败:`, err);
      });
    }
  }

  return {
    start() {
      stopped = false;
      for (const username of config.usernames) {
        connectUser(username);
      }
      console.error(`[ClockSSE] 桥接已启动, 监听 ${config.usernames.length} 个用户`);
    },

    stop() {
      stopped = true;
      for (const [, ctl] of controllers) {
        ctl.abort();
      }
      controllers.clear();
      console.error('[ClockSSE] 桥接已停止');
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
