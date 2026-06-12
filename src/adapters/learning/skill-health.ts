/**
 * Skill Health Monitor — 技能健康度监控
 *
 * 监控技能的成功率、使用次数、错误率，并给出晋升/降级/修复建议。
 */

import type { ILearningStore } from '../../ports/learning.js';
import type { ISkillRegistry, ISkillMeta } from '../../ports/skills.js';

export interface ISkillHealthConfig {
  /** 低于此成功率视为不健康（默认 0.5） */
  unhealthySuccessRate: number;
  /** 低于此使用次数视为低使用率（默认 2） */
  lowUsageThreshold: number;
  /** 高于此错误率视为高错误（默认 0.3） */
  highErrorRate: number;
}

export const DEFAULT_HEALTH_CONFIG: ISkillHealthConfig = {
  unhealthySuccessRate: 0.5,
  lowUsageThreshold: 2,
  highErrorRate: 0.3,
};

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unused';

export interface ISkillHealth {
  skillId: string;
  status: HealthStatus;
  successRate: number;
  usageCount: number;
  errorRate: number;
  issues: string[];
}

export interface IHealthAction {
  skillId: string;
  action: 'promote' | 'demote' | 'fix' | 'review' | 'keep';
  reason: string;
}

export interface ISkillHealthMonitor {
  readonly config: ISkillHealthConfig;
  checkSkillHealth(skillId: string): ISkillHealth;
  getHealthReport(): ISkillHealth[];
  suggestActions(): IHealthAction[];
}

export function createSkillHealthMonitor(
  learningStore: ILearningStore,
  skillRegistry: ISkillRegistry,
  partialConfig?: Partial<ISkillHealthConfig>,
): ISkillHealthMonitor {
  const config: ISkillHealthConfig = { ...DEFAULT_HEALTH_CONFIG, ...partialConfig };

  function checkSkillHealth(skillId: string): ISkillHealth {
    const skill = skillRegistry.getSkill(skillId);
    const issues: string[] = [];

    if (!skill) {
      return {
        skillId,
        status: 'unused',
        successRate: 0,
        usageCount: 0,
        errorRate: 0,
        issues: ['Skill not found in registry'],
      };
    }

    const usageCount = learningStore.getSkillUseCount(skillId);
    const toolNames = skill.toolNames ?? [];

    let totalInvocations = 0;
    let totalFailures = 0;

    for (const toolName of toolNames) {
      const history = learningStore.getUsageHistory('anonymous', toolName, 100);
      totalInvocations += history.length;
      totalFailures += history.filter(r => !r.success).length;
    }

    // Also count from skill-level usage
    if (totalInvocations === 0 && usageCount > 0) {
      totalInvocations = usageCount;
    }

    const successCount = totalInvocations - totalFailures;
    const successRate = totalInvocations > 0 ? successCount / totalInvocations : 0;
    const errorRate = totalInvocations > 0 ? totalFailures / totalInvocations : 0;

    let status: HealthStatus = 'healthy';

    if (usageCount < config.lowUsageThreshold && totalInvocations < config.lowUsageThreshold) {
      status = 'unused';
      issues.push(`Low usage: ${usageCount} skill uses, ${totalInvocations} tool invocations`);
    } else if (successRate < config.unhealthySuccessRate) {
      status = 'unhealthy';
      issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
    } else if (errorRate > config.highErrorRate) {
      status = 'degraded';
      issues.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }

    if (skill.status === 'draft' && usageCount >= 3 && successRate >= 0.7) {
      issues.push('Candidate skill performing well — consider promotion');
    }

    if (skill.status === 'verified' && successRate < 0.3) {
      issues.push('Verified skill performing poorly — consider demotion');
    }

    return { skillId, status, successRate, usageCount, errorRate, issues };
  }

  function getHealthReport(): ISkillHealth[] {
    const skills = skillRegistry.listSkills();
    return skills.map(s => checkSkillHealth(s.name));
  }

  function suggestActions(): IHealthAction[] {
    const report = getHealthReport();
    const actions: IHealthAction[] = [];

    for (const health of report) {
      const skill = skillRegistry.getSkill(health.skillId);

      if (health.status === 'unused') {
        actions.push({
          skillId: health.skillId,
          action: skill?.origin === 'static' ? 'review' : 'demote',
          reason: 'Skill is unused — consider removing or improving discoverability',
        });
      } else if (health.status === 'unhealthy') {
        actions.push({
          skillId: health.skillId,
          action: skill?.origin === 'static' ? 'fix' : 'demote',
          reason: `Success rate ${(health.successRate * 100).toFixed(1)}% is below threshold — fix or demote`,
        });
      } else if (health.status === 'degraded') {
        actions.push({
          skillId: health.skillId,
          action: 'fix',
          reason: `Error rate ${(health.errorRate * 100).toFixed(1)}% is high — investigate and fix`,
        });
      } else if (skill?.status === 'draft' && health.successRate >= 0.7 && health.usageCount >= 3) {
        actions.push({
          skillId: health.skillId,
          action: 'promote',
          reason: `Candidate performing well (${(health.successRate * 100).toFixed(1)}% success, ${health.usageCount} uses)`,
        });
      } else {
        actions.push({
          skillId: health.skillId,
          action: 'keep',
          reason: 'Skill is healthy',
        });
      }
    }

    return actions;
  }

  return { config, checkSkillHealth, getHealthReport, suggestActions };
}
