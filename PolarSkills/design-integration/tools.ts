/**
 * Design Integration — design_resolve + design_generate Tool 注册
 *
 * 桥接 PolarDesign 的 designResolve / designGenerate，
 * 通过 PolarClaw Skill 系统暴露给 Agent 调用。
 */

import { resolve } from 'node:path';
import type { IToolHandler } from '../../src/ports/tools.js';

const POLAR_DESIGN_DIR = resolve(
  process.env.POLAR_DESIGN_DIR ?? resolve(process.env.HOME ?? '~', 'Polarisor/PolarDesign'),
);

async function loadDesignModule() {
  const entryPoint = resolve(POLAR_DESIGN_DIR, 'dist/index.js');
  return import(entryPoint) as Promise<{
    designResolve: (styleDescription: string) => Array<{
      system: string;
      description: string;
      score: number;
      demoUrl: string;
      previewColors: string[];
    }>;
    designGenerate: (input: {
      skill: string;
      system: string;
      brief: string;
      inputs?: Record<string, unknown>;
    }) => {
      context: {
        designMd: string;
        skillMd: string;
        craftRules: string[];
        brief: string;
        inputs: Record<string, unknown>;
      };
      outputPath: string;
      previewUrl: string;
    };
    postProcess: (outputPath: string, html: string) => unknown;
  }>;
}

export const designResolveHandler: IToolHandler = {
  name: 'design_resolve',
  description:
    '根据风格关键词匹配设计系统，返回候选列表和 Demo 链接。用户选择后才进入生成流程。',
  parameters: {
    type: 'object',
    properties: {
      style_description: {
        type: 'string',
        description:
          '用户的风格描述，中英文均可。如："简洁暗色风格"、"信息密度高的仪表盘"',
      },
    },
    required: ['style_description'],
  },
  handler: async (args) => {
    const { style_description } = args as { style_description: string };
    if (!style_description || typeof style_description !== 'string') {
      return { error: 'style_description (string) is required' };
    }
    try {
      const mod = await loadDesignModule();
      const results = mod.designResolve(style_description);
      return { matches: results, count: results.length };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `design_resolve failed: ${msg}` };
    }
  },
};

export const designGenerateHandler: IToolHandler = {
  name: 'design_generate',
  description:
    '按 Skill + 设计系统生成 HTML 工件。返回生成上下文（DESIGN.md + SKILL.md + Craft 规则）供 Agent 使用。',
  parameters: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'Skill 名称，如 "dashboard"、"tech-sharing"、"report"',
      },
      system: {
        type: 'string',
        description: '设计系统名称，如 "polar-tech"、"polar-soft"、"polar-dense"',
      },
      brief: {
        type: 'string',
        description: '用户的简要需求描述',
      },
      inputs: {
        type: 'object',
        description: '可选的 Skill 参数（如 kpi_count、slide_count 等）',
      },
    },
    required: ['skill', 'system', 'brief'],
  },
  handler: async (args) => {
    const { skill, system, brief, inputs } = args as {
      skill: string;
      system: string;
      brief: string;
      inputs?: Record<string, unknown>;
    };
    if (!skill || !system || !brief) {
      return { error: 'skill, system, and brief are all required' };
    }
    try {
      const mod = await loadDesignModule();
      const result = mod.designGenerate({ skill, system, brief, inputs });
      return {
        outputPath: result.outputPath,
        previewUrl: result.previewUrl,
        context: {
          brief: result.context.brief,
          designSystem: system,
          skillName: skill,
          craftRulesCount: result.context.craftRules.length,
          designMdLength: result.context.designMd.length,
          skillMdLength: result.context.skillMd.length,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `design_generate failed: ${msg}` };
    }
  },
};

export const designTools: IToolHandler[] = [
  designResolveHandler,
  designGenerateHandler,
];

export default designTools;
