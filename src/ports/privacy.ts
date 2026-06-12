/**
 * Privacy Port — 隐私网关抽象
 *
 * 所有消息在进入 Agent 循环之前必须经过隐私网关的入站脱敏，
 * Agent 的回复在返回用户之前必须经过出站还原。
 *
 * 隐私网关 = PII 正则检测 + PolarPrivate 已知实体 + Secret 拦截
 */

/** PII 实体 */
export interface IPrivacyEntity {
  /** 实体类型：PHONE, EMAIL, NAME, COMPANY, SECRET 等 */
  type: string;
  /** 原始值 */
  value: string;
  /** 替换后的占位符：$PHONE_1, $NAME_1 等 */
  placeholder?: string;
}

/** 脱敏结果 */
export interface ISanitizeResult {
  /** 是否被拦截（用户发了不该发的 Secret） */
  blocked: boolean;
  /** 脱敏后的文本（blocked=true 时也会提供预览） */
  sanitized: string;
  /** 被检测到的实体列表 */
  entities: IPrivacyEntity[];
  /** 拦截时的警告信息 */
  warning?: string;
}

/** 隐私网关接口 */
export interface IPrivacyGateway {
  /**
   * 入站脱敏：用户消息进入 Agent 前处理
   * 1. 正则检测 PII（手机、身份证、邮箱等）
   * 2. PolarPrivate 已知实体替换
   * 3. Secret 拦截检查
   */
  sanitize(userId: string, text: string): Promise<ISanitizeResult>;

  /**
   * 出站还原：Agent 回复返回用户前，将占位符替换回真实值
   */
  desanitize(userId: string, text: string): string;

  /**
   * 加载用户的隐私实体（从 PolarPrivate 拉取）
   */
  loadEntities(userId: string): Promise<IPrivacyEntity[]>;

  /**
   * 清除用户的 PII vault（会话结束时调用）
   */
  clearVault(userId: string): void;
}
