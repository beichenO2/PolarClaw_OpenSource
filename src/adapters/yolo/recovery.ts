/**
 * YOLO 错误恢复策略适配器
 *
 * 分类错误并决定恢复动作：
 * - 瞬态错误（网络/超时）→ 重试
 * - 工具不存在 → 跳过
 * - 预算超限 → 中止
 * - 反复失败 → 上报用户
 */

import type { IRecoveryStrategy } from '../../ports/autonomous.js';

const TRANSIENT_PATTERNS = [
  /timeout/i,
  /ECONNREFUSED/,
  /ENOTFOUND/,
  /ETIMEDOUT/,
  /network/i,
  /429/,
  /503/,
  /502/,
];

const SKIP_PATTERNS = [
  /未注册的工具/,
  /not found/i,
  /not implemented/i,
];

const ABORT_PATTERNS = [
  /budget/i,
  /quota/i,
  /billing/i,
  /unauthorized/i,
  /403/,
];

export function createRecoveryStrategy(): IRecoveryStrategy {
  return {
    decide(error, context) {
      const msg = error.message;

      if (ABORT_PATTERNS.some(p => p.test(msg))) {
        return { type: 'abort', reason: `不可恢复: ${msg}` };
      }

      if (context.retriesSoFar >= context.maxRetries) {
        return {
          type: 'escalate',
          message: `步骤 ${context.step} 已重试 ${context.retriesSoFar} 次仍失败: ${msg}`,
        };
      }

      if (TRANSIENT_PATTERNS.some(p => p.test(msg))) {
        return { type: 'retry' };
      }

      if (SKIP_PATTERNS.some(p => p.test(msg))) {
        return { type: 'skip', reason: `跳过: ${msg}` };
      }

      if (context.retriesSoFar < 1) {
        return { type: 'retry' };
      }

      return {
        type: 'escalate',
        message: `步骤 ${context.step} 遇到未知错误: ${msg}`,
      };
    },
  };
}
