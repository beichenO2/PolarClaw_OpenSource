/**
 * Compression Port — 上下文压缩抽象
 *
 * 当对话历史接近 token 上限时，智能压缩中间轮次而非简单截断。
 * 三层压缩策略（渐进式，按需触发）：
 * - Phase 1: 结构化裁剪（截断工具输出、去冗余）
 * - Phase 2: 头尾保护 + 中间段合并
 * - Phase 3: LLM 摘要（用轻量模型总结中间轮次）
 */

import type { IChatMessage } from './memory.js';

/** 压缩结果 */
export interface ICompressionResult {
  /** 压缩后的消息列表 */
  messages: IChatMessage[];
  /** 压缩前的 token 估算 */
  originalTokens: number;
  /** 压缩后的 token 估算 */
  compressedTokens: number;
  /** 使用了哪些压缩阶段 */
  phasesUsed: number[];
}

/** 上下文压缩器接口 */
export interface IContextCompressor {
  /**
   * 判断是否需要压缩
   * @param messages 当前消息列表
   * @param budgetTokens token 预算上限
   */
  shouldCompress(messages: IChatMessage[], budgetTokens: number): boolean;

  /**
   * 执行压缩
   * @param messages 当前消息列表
   * @param budgetTokens token 预算上限
   */
  compress(messages: IChatMessage[], budgetTokens: number): Promise<ICompressionResult>;
}
