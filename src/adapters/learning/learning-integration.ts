/**
 * Learning Integration — 自学习系统集成模块
 *
 * 将 arrow_logs 模式检测 → 思考模板生成 → 注入 PolarPilot 的完整闭环。
 * 在 PolarClaw 启动时或定期运行，自动从射箭历史中学习。
 */

import type { ILearningStore } from '../../ports/learning.js';
import { createPatternDetector, type IArrowPattern } from './pattern-detector.js';
import {
  createThinkingTemplateGenerator,
  type IThinkingTemplate,
  type IThinkingTemplateGeneratorConfig,
} from './thinking-template-generator.js';

export interface ILearningIntegrationConfig {
  learningStore: ILearningStore;
  /** PolarPilot patterns 目录路径 */
  patternsDir: string;
  /** 最小命中率阈值 */
  minHitRate?: number;
  /** 最小出现次数阈值 */
  minOccurrences?: number;
  /** 模式检测配置 */
  patternDetectorConfig?: {
    minSequenceLen?: number;
    maxSequenceLen?: number;
    maxGapMs?: number;
    promotionThreshold?: number;
  };
}

export interface ILearningResult {
  /** 检测到的 arrow patterns */
  patterns: IArrowPattern[];
  /** 生成的思考模板 */
  templates: IThinkingTemplate[];
  /** 保存的模板数量 */
  savedCount: number;
  /** 处理时间 ms */
  durationMs: number;
}

export interface ILearningIntegration {
  /** 对指定项目运行学习循环 */
  learnFromProject(projectId: string): Promise<ILearningResult>;

  /** 对所有项目运行学习循环 */
  learnFromAllProjects(projectIds: string[]): Promise<Map<string, ILearningResult>>;

  /** 仅检测模式（不生成模板） */
  detectPatterns(projectId: string): IArrowPattern[];

  /** 手动注入模板到 PolarPilot */
  injectTemplate(template: IThinkingTemplate): boolean;
}

export function createLearningIntegration(
  config: ILearningIntegrationConfig,
): ILearningIntegration {
  const { learningStore, patternsDir, minHitRate = 0.7, minOccurrences = 3 } = config;

  const patternDetector = createPatternDetector(learningStore, config.patternDetectorConfig);
  const templateGenerator = createThinkingTemplateGenerator({
    patternsDir,
    minHitRate,
    minOccurrences,
  });

  return {
    async learnFromProject(projectId) {
      const start = Date.now();

      // Step 1: 从 arrow_logs 检测模式
      const patterns = patternDetector.detectFromArrowLogs(projectId);

      // Step 2: 从模式生成思考模板
      const { templates, saved } = templateGenerator.generateBatch(patterns);

      const durationMs = Date.now() - start;

      console.error(
        `[LearningIntegration] Project ${projectId}: ` +
        `detected ${patterns.length} patterns, ` +
        `generated ${templates.length} templates, ` +
        `saved ${saved} templates ` +
        `in ${durationMs}ms`,
      );

      return {
        patterns,
        templates,
        savedCount: saved,
        durationMs,
      };
    },

    async learnFromAllProjects(projectIds) {
      const results = new Map<string, ILearningResult>();

      for (const projectId of projectIds) {
        const result = await this.learnFromProject(projectId);
        results.set(projectId, result);
      }

      return results;
    },

    detectPatterns(projectId) {
      return patternDetector.detectFromArrowLogs(projectId);
    },

    injectTemplate(template) {
      const result = templateGenerator.generateAndSave({
        name: template.name,
        deltaPattern: template.description,
        hitRate: 1.0,
        occurrences: 1,
        hits: 1,
      });
      return result?.saved ?? false;
    },
  };
}

/**
 * 创建定时学习任务
 */
export function createScheduledLearning(
  integration: ILearningIntegration,
  projectIds: string[],
  intervalMs: number = 60 * 60 * 1000, // 默认每小时
): { start: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (timer) return;

      // 立即运行一次
      integration.learnFromAllProjects(projectIds).catch(err => {
        console.error('[ScheduledLearning] Error:', err);
      });

      // 设置定时器
      timer = setInterval(() => {
        integration.learnFromAllProjects(projectIds).catch(err => {
          console.error('[ScheduledLearning] Error:', err);
        });
      }, intervalMs);

      console.error(`[ScheduledLearning] Started with interval ${intervalMs}ms`);
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        console.error('[ScheduledLearning] Stopped');
      }
    },
  };
}
