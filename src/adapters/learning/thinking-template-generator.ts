/**
 * Thinking Template Generator — 从 arrow_logs 模式生成思考模板
 *
 * 当 PatternDetector 检测到高命中率的 delta 模式时，
 * 自动生成思考模板并注入 PolarPilot patterns/ 目录。
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IArrowPattern } from './pattern-detector.js';

export interface IThinkingTemplate {
  name: string;
  tags: string[];
  description: string;
  steps: string[];
  applicable_types: string[];
  version: string;
}

export interface IThinkingTemplateGeneratorConfig {
  /** PolarPilot patterns 目录路径 */
  patternsDir: string;
  /** 最小命中率阈值（默认 0.7） */
  minHitRate?: number;
  /** 最小出现次数阈值（默认 3） */
  minOccurrences?: number;
}

export interface IThinkingTemplateGenerator {
  /** 从 arrow pattern 生成思考模板 */
  generateFromArrowPattern(pattern: IArrowPattern): IThinkingTemplate | null;

  /** 生成并保存思考模板到 patterns 目录 */
  generateAndSave(pattern: IArrowPattern): { template: IThinkingTemplate; saved: boolean; path: string } | null;

  /** 批量生成并保存 */
  generateBatch(patterns: IArrowPattern[]): { generated: number; saved: number; templates: IThinkingTemplate[] };
}

/**
 * 从归一化的 delta 模式推断思考步骤
 */
function inferStepsFromDeltaPattern(deltaPattern: string): string[] {
  const steps: string[] = [];

  // 根据模式类型生成不同的思考步骤
  if (deltaPattern.includes('修改') || deltaPattern.includes('modify')) {
    steps.push(
      'Understand the current implementation before making changes',
      'Identify the minimal scope of the modification',
      'Check for existing tests that might be affected',
      'Make the change with clear intent',
      'Verify the change works as expected',
    );
  } else if (deltaPattern.includes('新增') || deltaPattern.includes('add')) {
    steps.push(
      'Identify where the new code should be placed',
      'Check for existing patterns or conventions to follow',
      'Implement the new functionality incrementally',
      'Add tests for the new functionality',
      'Verify integration with existing code',
    );
  } else if (deltaPattern.includes('删除') || deltaPattern.includes('delete') || deltaPattern.includes('remove')) {
    steps.push(
      'Verify the code is truly unused (check imports, references)',
      'Identify any tests that depend on this code',
      'Remove the code and update any related documentation',
      'Run tests to ensure no breakage',
      'Clean up any orphaned dependencies',
    );
  } else if (deltaPattern.includes('重构') || deltaPattern.includes('refactor')) {
    steps.push(
      'Ensure existing tests pass before refactoring',
      'Identify the specific refactoring goal',
      'Make small, incremental changes',
      'Run tests after each change',
      'Verify behavior is preserved',
    );
  } else if (deltaPattern.includes('修复') || deltaPattern.includes('fix')) {
    steps.push(
      'Reproduce the issue with a test case',
      'Identify the root cause (not just the symptom)',
      'Make the minimal fix that addresses the root cause',
      'Verify the fix works and no regressions introduced',
    );
  } else {
    // 通用步骤
    steps.push(
      'Understand the current state and desired outcome',
      'Identify the minimal change needed',
      'Implement the change',
      'Verify the change works correctly',
    );
  }

  return steps;
}

/**
 * 从 delta 模式推断标签
 */
function inferTagsFromDeltaPattern(deltaPattern: string): string[] {
  const tags: string[] = [];

  if (deltaPattern.includes('修改') || deltaPattern.includes('modify')) tags.push('modify', 'change', '修改');
  if (deltaPattern.includes('新增') || deltaPattern.includes('add')) tags.push('add', 'new', '新增');
  if (deltaPattern.includes('删除') || deltaPattern.includes('delete')) tags.push('delete', 'remove', '删除');
  if (deltaPattern.includes('重构') || deltaPattern.includes('refactor')) tags.push('refactor', '重构');
  if (deltaPattern.includes('修复') || deltaPattern.includes('fix')) tags.push('fix', 'bug', '修复');
  if (deltaPattern.includes('测试') || deltaPattern.includes('test')) tags.push('test', '测试');
  if (deltaPattern.includes('配置') || deltaPattern.includes('config')) tags.push('config', '配置');
  if (deltaPattern.includes('文档') || deltaPattern.includes('doc')) tags.push('doc', '文档');

  // 如果没有匹配到任何标签，添加通用标签
  if (tags.length === 0) {
    tags.push('general', '通用');
  }

  return tags;
}

/**
 * 生成模板名称
 */
function generateTemplateName(pattern: IArrowPattern): string {
  // 使用 pattern.name 或从 deltaPattern 推断
  const baseName = pattern.name || 'learned-pattern';

  // 清理名称，只保留字母、数字和连字符
  const cleaned = baseName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // 添加命中率后缀
  const hitRateSuffix = Math.round(pattern.hitRate * 100);
  return `learned-${cleaned}-${hitRateSuffix}pct`;
}

export function createThinkingTemplateGenerator(
  config: IThinkingTemplateGeneratorConfig,
): IThinkingTemplateGenerator {
  const { patternsDir, minHitRate = 0.7, minOccurrences = 3 } = config;

  return {
    generateFromArrowPattern(pattern) {
      // 检查阈值
      if (pattern.hitRate < minHitRate) return null;
      if (pattern.occurrences < minOccurrences) return null;

      const name = generateTemplateName(pattern);
      const steps = inferStepsFromDeltaPattern(pattern.deltaPattern);
      const tags = inferTagsFromDeltaPattern(pattern.deltaPattern);

      const template: IThinkingTemplate = {
        name,
        tags,
        description: `Auto-learned pattern with ${(pattern.hitRate * 100).toFixed(0)}% hit rate (${pattern.hits}/${pattern.occurrences} hits). Pattern: ${pattern.deltaPattern.slice(0, 100)}...`,
        steps,
        applicable_types: ['test_target'],
        version: '1.0',
      };

      return template;
    },

    generateAndSave(pattern) {
      const template = this.generateFromArrowPattern(pattern);
      if (!template) return null;

      // 确保 patterns 目录存在
      if (!existsSync(patternsDir)) {
        mkdirSync(patternsDir, { recursive: true });
      }

      const filePath = join(patternsDir, `${template.name}.json`);

      // 检查是否已存在
      if (existsSync(filePath)) {
        return { template, saved: false, path: filePath };
      }

      try {
        writeFileSync(filePath, JSON.stringify(template, null, 2), 'utf-8');
        console.error(`[ThinkingTemplateGenerator] Saved template: ${template.name}`);
        return { template, saved: true, path: filePath };
      } catch (err) {
        console.error(`[ThinkingTemplateGenerator] Failed to save template: ${err}`);
        return { template, saved: false, path: filePath };
      }
    },

    generateBatch(patterns) {
      const templates: IThinkingTemplate[] = [];
      let saved = 0;

      for (const pattern of patterns) {
        const result = this.generateAndSave(pattern);
        if (result) {
          templates.push(result.template);
          if (result.saved) saved++;
        }
      }

      console.error(`[ThinkingTemplateGenerator] Generated ${templates.length} templates, saved ${saved}`);
      return { generated: templates.length, saved, templates };
    },
  };
}

/**
 * 清理旧的自动生成模板
 */
export function cleanLearnedTemplates(patternsDir: string): number {
  if (!existsSync(patternsDir)) return 0;

  const files = readdirSync(patternsDir).filter(f =>
    f.startsWith('learned-') && f.endsWith('.json'),
  );

  let cleaned = 0;
  for (const file of files) {
    try {
      const { unlinkSync } = require('node:fs');
      unlinkSync(join(patternsDir, file));
      cleaned++;
    } catch {
      // ignore
    }
  }

  return cleaned;
}
