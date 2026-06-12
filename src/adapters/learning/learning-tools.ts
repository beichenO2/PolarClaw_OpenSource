/**
 * Learning Tools — Agent 侧的学习系统工具
 *
 * 将学习系统的能力暴露为 Agent 工具，让 Agent 可以：
 * - 记录用户反馈/纠正
 * - 查看用户偏好
 * - 检测并生成新技能
 * - 管理已加载技能
 * - 创建工作流组合
 */

import type { IToolHandler } from '../../ports/tools.js';
import type { ILearningStore } from '../../ports/learning.js';
import type { ISkillRegistry } from '../../ports/skills.js';
import type { ILearningIntegration } from './learning-integration.js';

export function createLearningTools(deps: {
  learningStore: ILearningStore;
  skillRegistry: ISkillRegistry;
  patternDetector: { detect: (userId: string) => unknown[]; getCandidates: () => unknown[] };
  skillGenerator: {
    generateFromPattern: (pattern: any) => any;
    generateFromDescription: (name: string, desc: string, examples?: string) => Promise<any>;
  };
  skillComposer: {
    compose: (workflow: any) => string;
    parseWorkflow: (json: string) => any;
  };
  /** 可选：学习集成模块（用于 arrow_logs 模式检测和思考模板生成） */
  learningIntegration?: ILearningIntegration;
}): IToolHandler[] {
  const { learningStore, skillRegistry, patternDetector, skillGenerator, skillComposer, learningIntegration } = deps;

  const recordFeedback: IToolHandler = {
    name: 'learning_record_feedback',
    description:
      '记录用户对 Agent 行为的反馈或纠正。当用户说"不对"、"我希望你这样做"等时主动调用。',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: '用户 ID' },
        type: { type: 'string', enum: ['correction', 'preference', 'complaint'], description: '反馈类型' },
        original: { type: 'string', description: '你（Agent）原来做了什么' },
        expected: { type: 'string', description: '用户期望的行为' },
        tool_name: { type: 'string', description: '相关的工具名（可选）' },
        rule: { type: 'string', description: '从此反馈中提取的规则/偏好（一句话总结）' },
      },
      required: ['user_id', 'type', 'original', 'expected'],
    },
    handler(args) {
      learningStore.recordFeedback({
        userId: String(args.user_id),
        type: args.type as 'correction' | 'preference' | 'complaint',
        original: String(args.original),
        expected: String(args.expected),
        toolName: args.tool_name ? String(args.tool_name) : undefined,
        rule: args.rule ? String(args.rule) : undefined,
      });
      return { ok: true, message: '已记录反馈' };
    },
  };

  const getPreferences: IToolHandler = {
    name: 'learning_get_preferences',
    description: '查询用户的已学习偏好规则。在工具调用前查询可提高准确度。',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: '用户 ID' },
        tool_name: { type: 'string', description: '特定工具名（可选，不填返回所有）' },
      },
      required: ['user_id'],
    },
    handler(args) {
      const prefs = learningStore.getPreferences(
        String(args.user_id),
        args.tool_name ? String(args.tool_name) : undefined,
      );
      return { preferences: prefs, count: prefs.length };
    },
  };

  const detectPatterns: IToolHandler = {
    name: 'learning_detect_patterns',
    description: '分析用户的工具使用历史，检测重复出现的调用模式。可用于自动生成新技能。',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['user_id'],
    },
    handler(args) {
      const newPatterns = patternDetector.detect(String(args.user_id));
      const candidates = patternDetector.getCandidates();
      return {
        new_patterns: newPatterns,
        promotable_candidates: candidates,
      };
    },
  };

  const generateSkill: IToolHandler = {
    name: 'learning_generate_skill',
    description:
      '从自然语言描述生成新技能。生成的技能自动写入 skills/ 目录并热加载。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名称（英文，用连字符分隔）' },
        description: { type: 'string', description: '功能描述（一句话）' },
        examples: { type: 'string', description: '使用示例（可选）' },
      },
      required: ['name', 'description'],
    },
    async handler(args) {
      const result = await skillGenerator.generateFromDescription(
        String(args.name),
        String(args.description),
        args.examples ? String(args.examples) : undefined,
      );

      if (!result) return { ok: false, error: '技能生成失败' };

      const loaded = await skillRegistry.loadSkill(result.skillDir);
      return {
        ok: true,
        skill: loaded?.name ?? result.meta.name,
        tools: loaded?.toolNames ?? [],
        dir: result.skillDir,
      };
    },
  };

  const listSkills: IToolHandler = {
    name: 'learning_list_skills',
    description: '列出所有已加载的技能及其工具，包含验证状态和使用次数。',
    parameters: { type: 'object', properties: {}, required: [] },
    handler() {
      const skills = skillRegistry.listSkills();
      return {
        skills: skills.map(s => ({
          name: s.name,
          description: s.description,
          origin: s.origin ?? 'static',
          status: s.status ?? (s.origin === 'static' ? 'verified' : 'draft'),
          successfulUses: s.successfulUses ?? 0,
          tools: s.toolNames ?? [],
          version: s.version,
        })),
        total: skills.length,
        draft: skills.filter(s => s.status === 'draft').length,
        verified: skills.filter(s => s.status === 'verified' || s.origin === 'static').length,
      };
    },
  };

  const composeWorkflow: IToolHandler = {
    name: 'learning_compose_workflow',
    description:
      '创建工作流：将多个工具串联/并联成新的复合工具。' +
      '参数 workflow_json 格式: { name, toolName, description, inputSchema, steps: [{ id, tool, args, dependsOn? }] }',
    parameters: {
      type: 'object',
      properties: {
        workflow_json: { type: 'string', description: '工作流定义 JSON' },
      },
      required: ['workflow_json'],
    },
    handler(args) {
      try {
        const workflow = skillComposer.parseWorkflow(String(args.workflow_json));
        const toolName = skillComposer.compose(workflow);
        return { ok: true, registered_tool: toolName, steps: workflow.steps.length };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const runArrowPatternLearning: IToolHandler = {
    name: 'learning_run_arrow_pattern',
    description:
      '从 arrow_logs 检测高命中率模式并生成思考模板。' +
      '当 pattern-detector 检测到高命中率 delta 模式时，自动生成思考模板并注入 PolarPilot patterns/ 目录。',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID' },
      },
      required: ['project_id'],
    },
    async handler(args) {
      if (!learningIntegration) {
        return { ok: false, error: 'learningIntegration not configured' };
      }

      try {
        const result = await learningIntegration.learnFromProject(String(args.project_id));
        return {
          ok: true,
          patterns_detected: result.patterns.length,
          templates_generated: result.templates.length,
          templates_saved: result.savedCount,
          duration_ms: result.durationMs,
          patterns: result.patterns.map(p => ({
            name: p.name,
            hit_rate: `${(p.hitRate * 100).toFixed(0)}%`,
            occurrences: p.occurrences,
            hits: p.hits,
          })),
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };

  const detectArrowPatterns: IToolHandler = {
    name: 'learning_detect_arrow_patterns',
    description: '从 arrow_logs 检测高命中率的 delta 模式，不生成模板，仅返回检测结果。',
    parameters: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: '项目 ID' },
      },
      required: ['project_id'],
    },
    handler(args) {
      if (!learningIntegration) {
        return { ok: false, error: 'learningIntegration not configured' };
      }

      const patterns = learningIntegration.detectPatterns(String(args.project_id));
      return {
        ok: true,
        count: patterns.length,
        patterns: patterns.map(p => ({
          name: p.name,
          delta_pattern: p.deltaPattern.slice(0, 100),
          hit_rate: `${(p.hitRate * 100).toFixed(0)}%`,
          occurrences: p.occurrences,
          hits: p.hits,
        })),
      };
    },
  };

  return [
    recordFeedback,
    getPreferences,
    detectPatterns,
    generateSkill,
    listSkills,
    composeWorkflow,
    runArrowPatternLearning,
    detectArrowPatterns,
  ];
}
