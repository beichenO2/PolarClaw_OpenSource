/**
 * Arrow Log Adapter — PolarPilot arrow_logs 接收适配器
 *
 * 将 PolarPilot 的 arrow_logs 接入 PolarClaw 的自学习系统。
 * 提供 HTTP API 端点供 PolarPilot 调用。
 */

import type { ILearningStore, IArrowLogRecord } from '../../ports/learning.js';

export interface IArrowLogAdapter {
  /** 接收单条 arrow_log */
  receive(log: ArrowLogInput): { success: boolean; error?: string };

  /** 批量接收 arrow_logs */
  receiveBatch(logs: ArrowLogInput[]): { success: boolean; received: number; errors?: string[] };

  /** 查询项目的 arrow_logs */
  query(projectId: string, limit?: number): IArrowLogRecord[];
}

export interface ArrowLogInput {
  project_id: string;
  target_id: string;
  ts: string;
  outcome: 'miss' | 'hit';
  delta: string;
  next_action: 'shoot' | 'moveboard' | 'escalate';
}

export function createArrowLogAdapter(learningStore: ILearningStore): IArrowLogAdapter {
  return {
    receive(log) {
      const validation = validateArrowLog(log);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      learningStore.recordArrowLog({
        projectId: log.project_id,
        targetId: log.target_id,
        ts: log.ts,
        outcome: log.outcome,
        delta: log.delta,
        nextAction: log.next_action,
      });

      return { success: true };
    },

    receiveBatch(logs) {
      const errors: string[] = [];
      let received = 0;

      for (let i = 0; i < logs.length; i++) {
        const validation = validateArrowLog(logs[i]!);
        if (!validation.valid) {
          errors.push(`[${i}] ${validation.error}`);
          continue;
        }

        learningStore.recordArrowLog({
          projectId: logs[i]!.project_id,
          targetId: logs[i]!.target_id,
          ts: logs[i]!.ts,
          outcome: logs[i]!.outcome,
          delta: logs[i]!.delta,
          nextAction: logs[i]!.next_action,
        });
        received++;
      }

      return {
        success: errors.length === 0,
        received,
        errors: errors.length > 0 ? errors : undefined,
      };
    },

    query(projectId, limit = 100) {
      return learningStore.getArrowLogs(projectId, limit);
    },
  };
}

function validateArrowLog(log: ArrowLogInput): { valid: true } | { valid: false; error: string } {
  if (!log.project_id || typeof log.project_id !== 'string') {
    return { valid: false, error: 'project_id is required and must be a string' };
  }
  if (!log.target_id || typeof log.target_id !== 'string') {
    return { valid: false, error: 'target_id is required and must be a string' };
  }
  if (!log.ts || typeof log.ts !== 'string') {
    return { valid: false, error: 'ts is required and must be a string (ISO timestamp)' };
  }
  if (log.outcome !== 'miss' && log.outcome !== 'hit') {
    return { valid: false, error: 'outcome must be "miss" or "hit"' };
  }
  if (typeof log.delta !== 'string') {
    return { valid: false, error: 'delta must be a string' };
  }
  if (!['shoot', 'moveboard', 'escalate'].includes(log.next_action)) {
    return { valid: false, error: 'next_action must be "shoot", "moveboard", or "escalate"' };
  }

  return { valid: true };
}

/**
 * 创建 Express 路由处理器
 */
export function createArrowLogRoutes(adapter: IArrowLogAdapter) {
  return {
    /** POST /api/claw/learning/arrow-logs */
    handlePost: (req: { body: ArrowLogInput | ArrowLogInput[] }) => {
      if (Array.isArray(req.body)) {
        return adapter.receiveBatch(req.body);
      }
      return adapter.receive(req.body);
    },

    /** GET /api/claw/learning/arrow-logs/:projectId */
    handleGet: (projectId: string, limit?: string) => {
      const parsedLimit = limit ? parseInt(limit, 10) : 100;
      return adapter.query(projectId, parsedLimit);
    },
  };
}
