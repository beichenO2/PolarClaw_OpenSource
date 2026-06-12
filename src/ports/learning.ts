/**
 * Learning Port — 自学习系统抽象
 *
 * 三个维度的学习能力：
 * 1. 工具使用追踪：记录每次工具调用的参数、结果、用户满意度
 * 2. 反馈采集：用户纠正 Agent 行为后，记录为可检索的偏好
 * 3. 模式识别：检测重复的多步工具调用序列，提取为可生成的技能
 */

/** 单次工具调用记录 */
export interface IToolUsageRecord {
  id?: number;
  /** 对话 ID */
  conversationId: string;
  /** 用户 ID */
  userId: string;
  /** 工具名称 */
  toolName: string;
  /** 调用参数 JSON */
  args: string;
  /** 返回结果 JSON（截断后） */
  result: string;
  /** 是否成功 */
  success: boolean;
  /** 调用耗时 ms */
  durationMs: number;
  /** 记录时间 */
  createdAt?: string;
}

/** 用户反馈/纠正记录 */
export interface IFeedbackRecord {
  id?: number;
  userId: string;
  /** 反馈类型 */
  type: 'correction' | 'preference' | 'complaint';
  /** 原始 Agent 行为描述 */
  original: string;
  /** 用户期望的行为 */
  expected: string;
  /** 相关工具名（可选） */
  toolName?: string;
  /** 提取的规则/偏好（LLM 总结后） */
  rule?: string;
  createdAt?: string;
}

/** 工具调用模式（多步序列） */
export interface IToolPattern {
  id?: number;
  /** 模式名称（自动生成或用户命名） */
  name: string;
  /** 工具调用序列 JSON: [{tool, argsTemplate}] */
  sequence: string;
  /** 触发条件描述 */
  trigger: string;
  /** 出现次数 */
  occurrences: number;
  /** 是否已提升为技能 */
  promoted: boolean;
  /** 关联的技能名（提升后） */
  skillName?: string;
  createdAt?: string;
}

/** 上下文增强建议（注入到 LLM prompt） */
export interface ILearningContext {
  /** 用户对此工具的偏好规则 */
  preferences: string[];
  /** 相关的成功调用模式 */
  patterns: string[];
}

/** PolarPilot arrow_log 记录（射箭历史） */
export interface IArrowLogRecord {
  id?: number;
  /** 项目 ID */
  projectId: string;
  /** 靶子 ID */
  targetId: string;
  /** 时间戳 */
  ts: string;
  /** 射箭结果 */
  outcome: 'miss' | 'hit';
  /** 改动描述（delta） */
  delta: string;
  /** 下一步动作 */
  nextAction: 'shoot' | 'moveboard' | 'escalate';
  /** 记录时间 */
  createdAt?: string;
}

/** 错误模式记录 — 记录重复出现的错误，辅助自动修复 */
export interface IErrorPattern {
  id?: number;
  /** 错误签名（hash of code + message，用于去重） */
  signature: string;
  /** 错误来源模块 */
  source: string;
  /** 错误类别 */
  category: 'network' | 'timeout' | 'auth' | 'validation' | 'internal' | 'dependency';
  /** 错误消息（模板化） */
  messageTemplate: string;
  /** 出现次数 */
  occurrences: number;
  /** 最近一次出现时间 */
  lastSeenAt: string;
  /** 已知的修复策略（JSON 数组） */
  resolutions: string;
  /** 是否已有自动修复 */
  autoFixed: boolean;
  createdAt?: string;
}

/** 学习存储接口 */
export interface ILearningStore {
  /** 记录一次工具调用 */
  recordUsage(record: IToolUsageRecord): void;

  /** 记录用户反馈 */
  recordFeedback(record: IFeedbackRecord): void;

  /** 记录 PolarPilot arrow_log（射箭历史） */
  recordArrowLog(record: IArrowLogRecord): void;

  /** 查询用户对某工具的使用历史 */
  getUsageHistory(userId: string, toolName: string, limit?: number): IToolUsageRecord[];

  /** 查询用户的所有反馈 */
  getFeedback(userId: string, type?: IFeedbackRecord['type']): IFeedbackRecord[];

  /** 获取用户对特定工具的偏好规则 */
  getPreferences(userId: string, toolName?: string): string[];

  /** 获取指定用户的学习上下文增强 */
  getLearningContext(userId: string, toolNames: string[]): ILearningContext;

  /** 保存识别到的工具调用模式 */
  savePattern(pattern: IToolPattern): void;

  /** 查询匹配的模式 */
  findPatterns(minOccurrences?: number): IToolPattern[];

  /** 标记模式已提升为技能 */
  promotePattern(patternId: number, skillName: string): void;

  /** 记录技能下某工具的一次成功使用，返回该技能的累计成功次数 */
  recordSkillUse(skillName: string, toolName: string): number;

  /** 查询技能的累计成功使用次数 */
  getSkillUseCount(skillName: string): number;

  /** 获取所有已注册的不同工具名（从 tool_usage 表动态查询） */
  getDistinctToolNames(userId: string): string[];

  /** 查询项目的 arrow_logs */
  getArrowLogs(projectId: string, limit?: number): IArrowLogRecord[];

  /** 记录/更新错误模式 */
  recordErrorPattern(pattern: IErrorPattern): void;

  /** 按签名查询错误模式 */
  getErrorPattern(signature: string): IErrorPattern | undefined;

  /** 查询高频错误（按出现次数降序） */
  getFrequentErrors(minOccurrences?: number, limit?: number): IErrorPattern[];

  /** 为错误模式添加修复策略 */
  addResolution(signature: string, resolution: string): void;
}
