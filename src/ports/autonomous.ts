/**
 * Autonomous Port — YOLO 自主执行引擎抽象
 *
 * 两层设计：
 * 1. 执行引擎 (Engine) — 连续多轮调用 Agent，无需用户逐步确认
 * 2. 恢复策略 (Recovery) — 工具失败/LLM 错误时的自动恢复
 *
 * YOLO 模式不改变 Agent 核心循环，而是在外层循环中反复调用 Agent。
 */

/** YOLO 会话配置 */
export interface IYoloSessionConfig {
  /** 项目 ID（用于 project lock） */
  projectId: string;
  /** 可选：预指定 session ID（Web API 使用） */
  sessionId?: string;
  /** 目标描述（用户的高层指令） */
  goal: string;
  /** 最大自主步数（防止无限循环） */
  maxSteps: number;
  /** 最大总 token 消耗（预算控制） */
  maxTotalTokens: number;
  /** 最大挂钟时间 ms */
  maxWallTimeMs: number;
  /** 单步失败最大重试次数 */
  maxRetries: number;
}

/** 单步执行结果 */
export interface IStepResult {
  /** 步骤序号 */
  step: number;
  /** Agent 回复文本 */
  text: string;
  /** 本步 token 消耗 */
  tokensUsed: number;
  /** 是否完成目标（Agent 判定） */
  goalReached: boolean;
  /** 是否出错 */
  error?: string;
  /** 耗时 ms */
  durationMs: number;
}

/** 恢复动作 */
export type RecoveryAction =
  | { type: 'retry' }
  | { type: 'skip'; reason: string }
  | { type: 'escalate'; message: string }
  | { type: 'abort'; reason: string };

/** 恢复策略接口 */
export interface IRecoveryStrategy {
  /** 根据错误信息决定恢复动作 */
  decide(error: Error, context: {
    step: number;
    retriesSoFar: number;
    maxRetries: number;
    goal: string;
  }): RecoveryAction;
}

/** YOLO 会话状态 */
export interface IYoloSessionState {
  /** 会话 ID */
  sessionId: string;
  /** 当前状态 */
  status: 'running' | 'completed' | 'aborted' | 'escalated';
  /** 已执行步数 */
  stepsCompleted: number;
  /** 已消耗 token */
  totalTokensUsed: number;
  /** 已用时间 ms */
  elapsedMs: number;
  /** 步骤记录 */
  steps: IStepResult[];
  /** 终止原因（非 completed 时） */
  stopReason?: string;
}

/** YOLO 引擎接口 */
export interface IYoloEngine {
  /**
   * 启动一个 YOLO 会话
   * @returns 最终会话状态
   */
  run(
    config: IYoloSessionConfig,
    context: { channel: string; userId: string; conversationId?: string; projectId: string },
  ): Promise<IYoloSessionState>;

  /** 取消正在运行的会话 */
  cancel(sessionId: string): void;

  /** 获取会话状态 */
  getSession(sessionId: string): IYoloSessionState | null;
}
