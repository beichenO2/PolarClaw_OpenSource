/**
 * Usage Tracker — 工具执行代理层
 *
 * 包装 IToolExecutor，在每次工具调用时自动记录使用记录到 LearningStore。
 * 不改变原有工具执行逻辑，纯观察者模式。
 *
 * 自进化晋升：当自动生成的技能成功使用 ≥ PROMOTION_THRESHOLD 次时，
 * 自动将其 status 从 draft 晋升为 verified。
 */

import type { IToolExecutor, IToolHandler } from '../../ports/tools.js';
import type { ILearningStore } from '../../ports/learning.js';
import type { IToolDefinition } from '../../ports/llm.js';
import type { ISkillRegistry } from '../../ports/skills.js';

const PROMOTION_THRESHOLD = 3;

export type PromotionListener = (skillName: string, useCount: number) => void;

export interface ITrackedToolExecutor extends IToolExecutor {
  /** 设置当前上下文（用于记录 userId / conversationId） */
  setContext(userId: string, conversationId: string): void;
  /** 获取当前上下文 userId（用于工具内部的数据隔离） */
  getCurrentUserId(): string;
  /** 注入 SkillRegistry 以启用自进化晋升 */
  setSkillRegistry(registry: ISkillRegistry): void;
  /** 晋升事件监听 */
  onPromotion(listener: PromotionListener): void;
}

export function createTrackedToolExecutor(
  inner: IToolExecutor,
  learningStore: ILearningStore,
): ITrackedToolExecutor {
  let currentUserId = 'anonymous';
  let currentConvId = 'unknown';
  let skillRegistry: ISkillRegistry | null = null;
  const promotionListeners: PromotionListener[] = [];
  const promotedSkills = new Set<string>();

  /** toolName → skillName reverse lookup (populated when registry is set) */
  function findSkillForTool(toolName: string): string | undefined {
    if (!skillRegistry) return undefined;
    for (const skill of skillRegistry.listSkills()) {
      if (skill.origin !== 'static' && skill.toolNames?.includes(toolName)) {
        return skill.name;
      }
    }
    return undefined;
  }

  function tryPromote(skillName: string): void {
    if (promotedSkills.has(skillName)) return;
    if (!skillRegistry) return;

    const skill = skillRegistry.getSkill(skillName);
    if (!skill || skill.status === 'verified' || skill.status === 'retired') return;

    const useCount = learningStore.getSkillUseCount(skillName);
    if (useCount >= PROMOTION_THRESHOLD) {
      skill.status = 'verified';
      skill.successfulUses = useCount;
      promotedSkills.add(skillName);
      console.error(`[SelfEvolution] 技能「${skillName}」已晋升为 verified (${useCount} 次成功使用)`);
      for (const listener of promotionListeners) {
        try { listener(skillName, useCount); } catch { /* non-critical */ }
      }
    }
  }

  return {
    register(tool: IToolHandler) {
      inner.register(tool);
    },

    unregister(name: string) {
      return inner.unregister(name);
    },

    async execute(name: string, args: Record<string, unknown>) {
      const start = Date.now();
      let success = true;
      let result: unknown;

      try {
        result = await inner.execute(name, args);
      } catch (err) {
        success = false;
        result = { error: err instanceof Error ? err.message : String(err) };
        throw err;
      } finally {
        const durationMs = Date.now() - start;
        try {
          let resultStr: string;
          try { resultStr = JSON.stringify(result); } catch { resultStr = String(result); }

          learningStore.recordUsage({
            conversationId: currentConvId,
            userId: currentUserId,
            toolName: name,
            args: JSON.stringify(args),
            result: resultStr,
            success,
            durationMs,
          });

          if (success) {
            const skillName = findSkillForTool(name);
            if (skillName) {
              learningStore.recordSkillUse(skillName, name);
              tryPromote(skillName);
            }
          }
        } catch {
          // recording failure is non-critical
        }
      }

      return result;
    },

    list(): IToolDefinition[] {
      return inner.list();
    },

    has(name: string) {
      return inner.has(name);
    },

    setContext(userId: string, conversationId: string) {
      currentUserId = userId;
      currentConvId = conversationId;
    },

    getCurrentUserId() {
      return currentUserId;
    },

    setSkillRegistry(registry: ISkillRegistry) {
      skillRegistry = registry;
      for (const skill of registry.listSkills()) {
        if (skill.origin !== 'static' && skill.status !== 'verified') {
          const count = learningStore.getSkillUseCount(skill.name);
          skill.successfulUses = count;
          if (count >= PROMOTION_THRESHOLD) {
            skill.status = 'verified';
            promotedSkills.add(skill.name);
          } else {
            skill.status = skill.status ?? 'draft';
          }
        }
      }
    },

    onPromotion(listener: PromotionListener) {
      promotionListeners.push(listener);
    },
  };
}
