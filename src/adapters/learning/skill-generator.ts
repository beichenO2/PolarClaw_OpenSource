/**
 * Skill Generator — 从模式/描述自动生成技能
 *
 * 两种生成模式：
 * 1. 从 PatternDetector 检测到的模式 → 生成组合技能（tools.ts 调用已有工具序列）
 * 2. 从自然语言描述 → 通过 LLM 生成新工具实现（需要 LLM 注入）
 *
 * 生成的技能写入 skills/ 目录，由 SkillRegistry 自动热加载。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IToolPattern } from '../../ports/learning.js';
import type { ILLMRouter } from '../../ports/llm.js';
import type { ISkillMeta } from '../../ports/skills.js';
import type { IChatMessage } from '../../ports/memory.js';

export interface ISkillGeneratorConfig {
  /** 生成的技能输出目录（默认 skills/） */
  outputDir: string;
}

export interface IGeneratedSkill {
  meta: ISkillMeta;
  skillDir: string;
  fromPattern?: IToolPattern;
}

export function createSkillGenerator(config: ISkillGeneratorConfig, llm?: ILLMRouter) {
  const { outputDir } = config;

  return {
    /**
     * 从检测到的工具调用模式生成组合技能。
     * 生成的工具是一个 wrapper，按顺序调用原有工具并聚合结果。
     */
    generateFromPattern(pattern: IToolPattern): IGeneratedSkill | null {
      const steps = JSON.parse(pattern.sequence) as { tool: string; argsKeys: string[] }[];
      if (steps.length < 2) return null;

      const skillName = `auto-${sanitizeName(pattern.name)}`;
      const skillDir = join(outputDir, skillName);

      if (existsSync(skillDir)) return null;
      mkdirSync(skillDir, { recursive: true });

      const toolName = snakeCase(pattern.name);
      const description = `自动生成的组合工具：${pattern.trigger}（${steps.map(s => s.tool).join(' → ')}）`;

      const allArgsKeys = new Set<string>();
      for (const step of steps) {
        for (const key of step.argsKeys) allArgsKeys.add(key);
      }

      const skillMd = generateSkillMd(skillName, description, [toolName], pattern);
      const toolsTs = generateCompositeToolsTs(toolName, description, steps, allArgsKeys);

      writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
      writeFileSync(join(skillDir, 'tools.ts'), toolsTs);

      const meta: ISkillMeta = {
        name: skillName,
        description,
        version: '0.1.0',
        path: join(skillDir, 'SKILL.md'),
        origin: 'generated',
        status: 'draft',
        successfulUses: 0,
        createdAt: new Date().toISOString(),
      };

      console.error(`[SkillGenerator] 从模式生成技能: ${skillName} (${steps.length} 步) [draft]`);
      return { meta, skillDir, fromPattern: pattern };
    },

    /**
     * 从自然语言描述生成新技能（需要 LLM）。
     * 用户说"帮我做一个 XX 工具"时调用。
     */
    async generateFromDescription(
      name: string,
      description: string,
      examples?: string,
    ): Promise<IGeneratedSkill | null> {
      if (!llm) {
        console.error('[SkillGenerator] LLM 未注入，无法从描述生成技能');
        return null;
      }

      const skillName = `custom-${sanitizeName(name)}`;
      const skillDir = join(outputDir, skillName);

      if (existsSync(skillDir)) return null;
      mkdirSync(skillDir, { recursive: true });

      const prompt = buildGenerationPrompt(skillName, description, examples);
      const messages: IChatMessage[] = [
        { role: 'system', content: GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ];

      try {
        const response = await llm.chat(messages as any, {
          temperature: 0.3,
          maxTokens: 4096,
        });

        const content = response.content ?? '';
        const { skillMd, toolsTs } = parseGeneratedCode(content, skillName, description);

        writeFileSync(join(skillDir, 'SKILL.md'), skillMd);
        writeFileSync(join(skillDir, 'tools.ts'), toolsTs);

        const meta: ISkillMeta = {
          name: skillName,
          description,
          version: '0.1.0',
          path: join(skillDir, 'SKILL.md'),
          origin: 'generated',
          status: 'draft',
          successfulUses: 0,
          createdAt: new Date().toISOString(),
        };

        console.error(`[SkillGenerator] 从描述生成技能: ${skillName} [draft]`);
        return { meta, skillDir };
      } catch (err) {
        console.error(`[SkillGenerator] LLM 生成失败:`, err);
        // clean up empty dir
        try {
          const { rmdirSync } = await import('node:fs');
          rmdirSync(skillDir);
        } catch { /* ok */ }
        return null;
      }
    },
  };
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function snakeCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function generateSkillMd(
  name: string,
  description: string,
  toolNames: string[],
  pattern?: IToolPattern,
): string {
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    'version: 0.1.0',
    `origin: generated`,
    '---',
    '',
    `# ${name}`,
    '',
    `## 能力`,
    '',
    `- ${description}`,
    '',
    `## 工具列表`,
    '',
    ...toolNames.map(t => `- \`${t}\``),
  ];

  if (pattern) {
    const steps = JSON.parse(pattern.sequence) as { tool: string }[];
    lines.push(
      '',
      '## 源模式',
      '',
      `触发条件: ${pattern.trigger}`,
      `出现次数: ${pattern.occurrences}`,
      `工具序列: ${steps.map(s => s.tool).join(' → ')}`,
    );
  }

  return lines.join('\n') + '\n';
}

function generateCompositeToolsTs(
  toolName: string,
  description: string,
  steps: { tool: string; argsKeys: string[] }[],
  allArgsKeys: Set<string>,
): string {
  const properties: string[] = [];
  for (const key of allArgsKeys) {
    properties.push(`      ${key}: { type: 'string', description: '${key}' },`);
  }

  const stepCalls = steps.map((step, i) => {
    const argMapping = step.argsKeys.map(k => `${k}: args.${k}`).join(', ');
    return `
    // Step ${i + 1}: ${step.tool}
    const step${i + 1}Args = { ${argMapping} };
    let step${i + 1}Result: unknown;
    try {
      const handler = toolRegistry.get('${step.tool}');
      step${i + 1}Result = handler ? await handler(step${i + 1}Args) : { error: 'tool not found: ${step.tool}' };
    } catch (e) {
      step${i + 1}Result = { error: e instanceof Error ? e.message : String(e) };
    }`;
  }).join('\n');

  const resultObj = steps.map((_, i) => `      step${i + 1}: step${i + 1}Result,`).join('\n');

  return `/**
 * Auto-generated composite tool: ${toolName}
 * ${description}
 *
 * Generated at: ${new Date().toISOString()}
 */

import type { IToolHandler } from '../../src/ports/tools.js';

/**
 * 工具注册表引用，由 SkillRegistry 注入。
 * 组合技能通过此 Map 调用其他已注册工具。
 */
export const toolRegistry = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

export const ${camelCase(toolName)}Tool: IToolHandler = {
  name: '${toolName}',
  description: '${escapeQuotes(description)}',
  parameters: {
    type: 'object',
    properties: {
${properties.join('\n')}
    },
    required: [],
  },
  async handler(args: Record<string, unknown>) {
${stepCalls}

    return {
${resultObj}
    };
  },
};

export const tools: IToolHandler[] = [${camelCase(toolName)}Tool];
`;
}

function camelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function escapeQuotes(s: string): string {
  return s.replace(/'/g, "\\'");
}

const GENERATION_SYSTEM_PROMPT = `你是一个 TypeScript 代码生成器。用户会描述一个工具的功能，你需要生成两个文件内容：

1. SKILL.md — YAML frontmatter + 工具说明
2. tools.ts — 实现 IToolHandler 接口的工具代码

规则：
- tools.ts 必须导出 \`tools: IToolHandler[]\`
- IToolHandler 接口: { name, description, parameters, handler(args) }
- parameters 使用 JSON Schema 格式
- handler 返回 JSON-serializable 对象
- 不要引入外部依赖，只用 Node.js 内置模块和 fetch
- 用 TypeScript 编写，保持简洁

输出格式：
\`\`\`skill.md
(SKILL.md 内容)
\`\`\`

\`\`\`tools.ts
(tools.ts 内容)
\`\`\``;

function buildGenerationPrompt(name: string, description: string, examples?: string): string {
  let prompt = `请为以下工具生成 SKILL.md 和 tools.ts：

名称: ${name}
功能描述: ${description}`;

  if (examples) {
    prompt += `\n\n使用示例:\n${examples}`;
  }

  return prompt;
}

function parseGeneratedCode(
  llmOutput: string,
  fallbackName: string,
  fallbackDesc: string,
): { skillMd: string; toolsTs: string } {
  const skillMdMatch = llmOutput.match(/```skill\.md\n([\s\S]*?)```/);
  const toolsTsMatch = llmOutput.match(/```tools\.ts\n([\s\S]*?)```/);

  const skillMd = skillMdMatch?.[1]?.trim() ?? generateSkillMd(fallbackName, fallbackDesc, [snakeCase(fallbackName)]);
  const toolsTs = toolsTsMatch?.[1]?.trim() ?? `// LLM 生成失败，请手动编写\nimport type { IToolHandler } from '../../src/ports/tools.js';\nexport const tools: IToolHandler[] = [];\n`;

  return { skillMd, toolsTs };
}
