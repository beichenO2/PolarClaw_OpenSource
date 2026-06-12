/**
 * Proactive Port — 主动关怀引擎抽象
 *
 * 两层设计：
 * 1. 调度器 (Scheduler) — 决定"何时"触发（cron / 条件 / 外部信号）
 * 2. 关怀策略 (CarePolicy) — 决定"说什么"（模板 / LLM 生成 / 上下文感知）
 *
 * 调度器触发 → 策略生成消息 → 注入 Agent 核心循环 → 通道发送
 */

/** 触发条件 */
export interface IProactiveTrigger {
  /** 触发类型 */
  type: 'cron' | 'condition' | 'event';
  /** 目标用户 ID */
  userId: string;
  /** 触发原因（调度器填充，供策略决策） */
  reason: string;
  /** 附加上下文 */
  context?: Record<string, unknown>;
}

/** 关怀策略生成的消息 */
export interface IProactiveMessage {
  /** 目标用户 */
  userId: string;
  /** 消息正文（注入 Agent 的合成 prompt） */
  prompt: string;
  /** 优先级（high 立即发送，low 排队） */
  priority: 'high' | 'normal' | 'low';
  /** 消息类型标签 */
  tag: string;
}

/** 关怀策略接口 */
export interface ICarePolicy {
  /**
   * 根据触发条件决定是否关怀 + 生成消息
   * 返回 null 表示此次不需要关怀
   */
  evaluate(trigger: IProactiveTrigger): Promise<IProactiveMessage | null>;
}

/** 调度规则 */
export interface IScheduleRule {
  /** 规则 ID */
  id: string;
  /** 目标用户 ID */
  userId: string;
  /** cron 表达式（简化版：支持 HH:MM 或间隔分钟数） */
  schedule: string;
  /** 触发原因模板 */
  reason: string;
  /** 是否启用 */
  enabled: boolean;
  /** 上次触发时间 */
  lastTriggeredAt?: Date;
}

/** 主动关怀引擎接口 */
export interface IProactiveEngine {
  /** 启动调度（开始定时检查） */
  start(): void;
  /** 停止调度 */
  stop(): void;
  /** 手动触发一次关怀检查（测试/调试用） */
  trigger(trigger: IProactiveTrigger): Promise<IProactiveMessage | null>;
  /** 添加调度规则 */
  addRule(rule: IScheduleRule): void;
  /** 移除调度规则 */
  removeRule(ruleId: string): boolean;
  /** 列出当前规则 */
  listRules(): IScheduleRule[];
}
