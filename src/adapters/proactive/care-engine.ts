/**
 * 主动关怀引擎适配器
 *
 * 实现 IProactiveEngine + ICarePolicy。
 * 调度器定时检查规则 → 策略评估是否关怀 → 生成消息 → 通过回调注入 Agent。
 *
 * 关怀策略基于：
 * - 用户最后活跃时间（长时间未活跃 → 关怀提醒）
 * - Clock 状态（番茄钟结束 → 休息提醒）
 * - 自定义规则（用户配置的定时关怀）
 */

import type {
  IProactiveEngine,
  IProactiveTrigger,
  IProactiveMessage,
  ICarePolicy,
  IScheduleRule,
} from '../../ports/proactive.js';
import type { IMemoryStore } from '../../ports/memory.js';
import type { IToolExecutor } from '../../ports/tools.js';

export interface ICareEngineConfig {
  /** 调度轮询间隔 ms（默认 60000 = 1 分钟） */
  pollIntervalMs?: number;
  /** 同一用户两次关怀最小间隔 ms（默认 2 小时） */
  minCareIntervalMs?: number;
  /** 用户不活跃多久后触发关怀 ms（默认 4 小时） */
  inactivityThresholdMs?: number;
  /** 空闲多久后触发话题 ms（默认 30 分钟） */
  idleTopicThresholdMs?: number;
  /** 连续工作多久后触发话题 ms（默认 3 小时） */
  longWorkTopicThresholdMs?: number;
  /** KnowLever API URL（可选，用于获取新知识作为话题素材） */
  knowLeverUrl?: string;
}

export interface ICareEngineDeps {
  memory: IMemoryStore;
  tools: IToolExecutor;
  /** 关怀消息发出时的回调（由 main.ts 注入，桥接到 Agent） */
  onCareMessage: (message: IProactiveMessage) => Promise<void>;
}

export function createCarePolicy(
  deps: { memory: IMemoryStore; tools: IToolExecutor },
  config: { inactivityThresholdMs: number },
): ICarePolicy {
  return {
    async evaluate(trigger) {
      switch (trigger.reason) {
        case 'inactivity': {
          const lastActive = deps.memory.getProfile(trigger.userId, 'lastActiveAt');
          if (!lastActive) return null;

          const elapsed = Date.now() - new Date(lastActive).getTime();
          if (elapsed < config.inactivityThresholdMs) return null;

          const hour = new Date().getHours();
          if (hour < 8 || hour > 22) return null;

          const profiles = deps.memory.getAllProfiles(trigger.userId);
          const nameEntry = profiles.find(p => p.key === 'name' || p.key === 'displayName');
          const userName = nameEntry?.value ?? '你';

          return {
            userId: trigger.userId,
            prompt: buildInactivityPrompt(userName, elapsed),
            priority: 'low',
            tag: 'inactivity-care',
          };
        }

        case 'timer-complete': {
          if (!deps.tools.has('clock_get_timer_status')) return null;
          let status: unknown;
          try {
            status = await deps.tools.execute('clock_get_timer_status', { username: trigger.userId });
          } catch { return null; }

          return {
            userId: trigger.userId,
            prompt: `[系统提示：用户的番茄钟刚刚结束。请根据用户的工作状态，自然地建议休息或继续。当前状态：${JSON.stringify(status)}]`,
            priority: 'normal',
            tag: 'timer-care',
          };
        }

        case 'scheduled': {
          return {
            userId: trigger.userId,
            prompt: trigger.context?.prompt as string
              ?? '[系统提示：这是一条定时关怀。请自然地和用户打个招呼，问问近况。]',
            priority: 'normal',
            tag: 'scheduled-care',
          };
        }

        case 'schedule-pre-alert': {
          const block = trigger.context?.block as { name?: string; start_hhmm?: string; type?: string } | undefined;
          const minutesLeft = trigger.context?.minutesLeft as number | undefined;
          if (block?.type === 'meal') {
            return {
              userId: trigger.userId,
              prompt: `[系统提示：${block.name ?? '用餐'}时间快到了（${minutesLeft ?? '?'}分钟后）。自然地提醒用户注意用餐，不要太机械。]`,
              priority: 'normal',
              tag: 'schedule-meal-alert',
            };
          }
          return {
            userId: trigger.userId,
            prompt: `[系统提示：用户的日程「${block?.name ?? '活动'}」将在 ${minutesLeft ?? '?'} 分钟后开始（${block?.start_hhmm ?? ''}）。自然地提醒用户准备。]`,
            priority: 'normal',
            tag: 'schedule-pre-alert',
          };
        }

        case 'schedule-ended': {
          const block = trigger.context?.block as { name?: string; type?: string } | undefined;
          return {
            userId: trigger.userId,
            prompt: `[系统提示：用户的日程「${block?.name ?? '活动'}」刚刚结束。如果合适，自然地问问感受或建议接下来的安排。]`,
            priority: 'low',
            tag: 'schedule-ended',
          };
        }

        case 'topic': {
          const topic = trigger.context?.topic as string | undefined;
          const source = trigger.context?.source as string | undefined;
          const basePrompt = topic
            ? `[系统提示：你发现了一个有趣的话题——${topic}${source ? `（来源：${source}）` : ''}。以自然的方式和用户分享，引发讨论。不要显得机械。]`
            : `[系统提示：用户已经连续工作很久了。主动发起一个有趣的话题，比如讨论一个技术方向、分享一个发现、或者聊聊对未来的想法。话题应该有实质内容，不是空洞的寒暄。]`;
          return {
            userId: trigger.userId,
            prompt: basePrompt,
            priority: 'low',
            tag: 'topic-initiative',
          };
        }

        default:
          return null;
      }
    },
  };
}

function buildInactivityPrompt(name: string, elapsedMs: number): string {
  const hours = Math.floor(elapsedMs / 3600000);
  if (hours < 6) {
    return `[系统提示：${name}已经 ${hours} 小时没有消息了。请以自然的方式关心一下，不要显得机械。不要提及你是被系统触发的。]`;
  }
  return `[系统提示：${name}已经很久（${hours} 小时）没有活动了。如果合适的话，发送一条简短的关怀消息。注意时间和语境，不要打扰。]`;
}

function parseSchedule(schedule: string): number | null {
  const match = schedule.match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 0);
}

export function createCareEngine(
  config: ICareEngineConfig,
  deps: ICareEngineDeps,
): IProactiveEngine {
  const pollInterval = config.pollIntervalMs ?? 60000;
  const minCareInterval = config.minCareIntervalMs ?? 2 * 3600000;
  const inactivityThreshold = config.inactivityThresholdMs ?? 4 * 3600000;
  const idleTopicThreshold = config.idleTopicThresholdMs ?? 30 * 60000;
  const longWorkTopicThreshold = config.longWorkTopicThresholdMs ?? 3 * 3600000;

  const rules: Map<string, IScheduleRule> = new Map();
  const lastCareTime: Map<string, number> = new Map();
  let timer: ReturnType<typeof setInterval> | null = null;

  const policy = createCarePolicy(
    { memory: deps.memory, tools: deps.tools },
    { inactivityThresholdMs: inactivityThreshold },
  );

  const lastTopicTime: Map<string, number> = new Map();

  async function fetchKnowLeverTopic(): Promise<{ topic: string; source: string } | null> {
    if (!config.knowLeverUrl) return null;
    try {
      const res = await fetch(`${config.knowLeverUrl}/api/search?q=*&limit=1&sort=created_desc`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const data = await res.json() as { results?: { title?: string; source?: string }[] };
      const top = data.results?.[0];
      if (top?.title) return { topic: top.title, source: top.source ?? 'KnowLever' };
    } catch { /* KnowLever not available */ }
    return null;
  }

  async function checkRules() {
    const now = Date.now();

    for (const rule of rules.values()) {
      if (!rule.enabled) continue;

      const intervalMs = parseSchedule(rule.schedule);
      if (!intervalMs) continue;

      const lastTriggered = rule.lastTriggeredAt?.getTime() ?? 0;
      if (now - lastTriggered < intervalMs) continue;

      const lastCare = lastCareTime.get(rule.userId) ?? 0;
      if (now - lastCare < minCareInterval) continue;

      const trigger: IProactiveTrigger = {
        type: 'cron',
        userId: rule.userId,
        reason: rule.reason,
      };

      const message = await policy.evaluate(trigger);
      if (message) {
        rule.lastTriggeredAt = new Date(now);
        lastCareTime.set(rule.userId, now);
        try {
          await deps.onCareMessage(message);
        } catch (err) {
          console.error(`[CareEngine] 发送关怀消息失败 (${rule.userId}):`, err);
        }
      }
    }

    // Topic initiative: idle or extended work sessions
    const checkedUsers = new Set<string>();
    for (const rule of rules.values()) {
      if (!rule.enabled) continue;
      const uid = rule.userId;
      if (checkedUsers.has(uid)) continue;
      checkedUsers.add(uid);

      const lastActive = deps.memory.getProfile(uid, 'lastActiveAt');
      if (!lastActive) continue;

      const activeSince = new Date(lastActive).getTime();
      const elapsed = now - activeSince;
      const lt = lastTopicTime.get(uid) ?? 0;
      const lastCare = lastCareTime.get(uid) ?? 0;

      // Skip if recently sent a topic or care message
      const topicCooldown = Math.min(idleTopicThreshold, longWorkTopicThreshold);
      if (now - lt < topicCooldown) continue;
      if (now - lastCare < minCareInterval) continue;

      let shouldTrigger = false;
      let context: Record<string, unknown> = {};

      if (elapsed >= longWorkTopicThreshold) {
        shouldTrigger = true;
        context = { reason: 'long_work', sessionMinutes: Math.round(elapsed / 60000) };
      } else if (elapsed >= idleTopicThreshold && elapsed < inactivityThreshold) {
        shouldTrigger = true;
        const klTopic = await fetchKnowLeverTopic();
        if (klTopic) {
          context = { topic: klTopic.topic, source: klTopic.source, reason: 'idle_knowledge' };
        } else {
          context = { reason: 'idle' };
        }
      }

      if (shouldTrigger) {
        const trigger: IProactiveTrigger = {
          type: 'condition',
          userId: uid,
          reason: 'topic',
          context,
        };
        const message = await policy.evaluate(trigger);
        if (message) {
          lastTopicTime.set(uid, now);
          lastCareTime.set(uid, now);
          try {
            await deps.onCareMessage(message);
          } catch (err) {
            console.error(`[CareEngine] 话题触发失败 (${uid}):`, err);
          }
        }
        break; // one topic per cycle
      }
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void checkRules(), pollInterval);
      console.error(`[CareEngine] 已启动，轮询间隔 ${pollInterval / 1000}s`);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.error('[CareEngine] 已停止');
      }
    },

    async trigger(trigger) {
      const lastCare = lastCareTime.get(trigger.userId) ?? 0;
      if (Date.now() - lastCare < minCareInterval) return null;

      const message = await policy.evaluate(trigger);
      if (message) {
        lastCareTime.set(trigger.userId, Date.now());
        await deps.onCareMessage(message);
      }
      return message;
    },

    addRule(rule) {
      rules.set(rule.id, rule);
    },

    removeRule(ruleId) {
      return rules.delete(ruleId);
    },

    listRules() {
      return [...rules.values()];
    },
  };
}
