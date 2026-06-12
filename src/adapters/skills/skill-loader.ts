/**
 * Skill 加载器适配器
 *
 * 实现 ISkillLoader 接口。
 * 扫描 skills 目录，解析 SKILL.md frontmatter 元数据，
 * 动态导入 tools.ts 文件并注册到 Agent 工具系统。
 *
 * Skill 目录约定：
 * skills/
 *   └── {skill-name}/
 *       ├── SKILL.md    — YAML frontmatter 定义元数据
 *       └── tools.ts    — 导出 IToolHandler[] 或命名导出 {skillName}Tools
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ISkillLoader, ISkillMeta } from '../../ports/skills.js';
import type { IToolHandler } from '../../ports/tools.js';

let tsxRegistered = false;

async function ensureTsxLoader(): Promise<void> {
  if (tsxRegistered) return;
  try {
    const { register } = await import('node:module') as { register: (specifier: string, parentUrl: string | URL) => void };
    register('tsx/esm', pathToFileURL(join(process.cwd(), 'node_modules', 'tsx', '/')));
    tsxRegistered = true;
  } catch {
    // tsx not available — .ts skill imports will fail gracefully
  }
}

/** 解析 SKILL.md 的 YAML frontmatter（简单解析，不依赖外部库） */
function parseFrontmatter(content: string): Record<string, string | Record<string, string>> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string | Record<string, string>> = {};
  let currentKey = '';
  let nestedObj: Record<string, string> | null = null;

  for (const line of match[1]!.split('\n')) {
    // 嵌套键值对（2 空格缩进）
    const nestedMatch = line.match(/^  (\S+):\s*(.+)/);
    if (nestedMatch && currentKey) {
      if (!nestedObj) nestedObj = {};
      nestedObj[nestedMatch[1]!] = nestedMatch[2]!.replace(/^["']|["']$/g, '');
      result[currentKey] = nestedObj;
      continue;
    }

    // 顶层键值对
    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      // 保存前一个嵌套对象
      if (currentKey && nestedObj) {
        result[currentKey] = nestedObj;
      }
      currentKey = kvMatch[1]!;
      nestedObj = null;
      const val = kvMatch[2]!.replace(/^["']|["']$/g, '').trim();
      if (val) result[currentKey] = val;
    }
  }

  return result;
}

export function createSkillLoader(): ISkillLoader {
  return {
    scan(dirs) {
      const skills: ISkillMeta[] = [];

      for (const dir of dirs) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir);
        for (const entry of entries) {
          const skillDir = join(dir, entry);
          if (!statSync(skillDir).isDirectory()) continue;

          const skillMdPath = join(skillDir, 'SKILL.md');
          if (!existsSync(skillMdPath)) continue;

          const content = readFileSync(skillMdPath, 'utf8');
          const fm = parseFrontmatter(content);

          const meta: ISkillMeta = {
            name: typeof fm.name === 'string' ? fm.name : basename(skillDir),
            description: typeof fm.description === 'string' ? fm.description : '',
            version: typeof fm.version === 'string' ? fm.version : undefined,
            requires: typeof fm.requires === 'object' ? fm.requires as Record<string, string> : undefined,
            path: skillMdPath,
          };

          skills.push(meta);
          console.error(`[SkillLoader] 发现技能: ${meta.name} (${meta.path})`);
        }
      }

      return skills;
    },

    async registerTools(skills, register) {
      const SKILL_IMPORT_TIMEOUT = 10000;

      for (const skill of skills) {
        const skillDir = join(skill.path, '..');

        const jsPath = join(skillDir, 'tools.js');
        const tsPath = join(skillDir, 'tools.ts');
        const toolsPath = existsSync(jsPath) ? jsPath : tsPath;

        if (!existsSync(toolsPath)) {
          console.error(`[SkillLoader] ${skill.name}: 未找到 tools.ts/js，跳过`);
          continue;
        }

        try {
          if (toolsPath.endsWith('.ts')) {
            await ensureTsxLoader();
          }

          const mod = await Promise.race([
            import(pathToFileURL(toolsPath).href),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`import 超时 (${SKILL_IMPORT_TIMEOUT}ms)`)), SKILL_IMPORT_TIMEOUT)
            ),
          ]);

          let handlers: IToolHandler[] = [];

          if (Array.isArray(mod.default)) {
            handlers = mod.default;
          } else {
            for (const [key, val] of Object.entries(mod)) {
              if (Array.isArray(val) && key.endsWith('Tools')) {
                handlers = val as IToolHandler[];
                break;
              }
            }
            if (handlers.length === 0 && Array.isArray(mod.tools)) {
              handlers = mod.tools;
            }
          }

          for (const tool of handlers) {
            register({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              handler: async (args) => tool.handler(args),
            });
            console.error(`[SkillLoader] 注册工具: ${tool.name} (来自 ${skill.name})`);
          }

          if (handlers.length === 0) {
            console.error(`[SkillLoader] ${skill.name}: tools.ts 未导出有效的工具数组`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[SkillLoader] ${skill.name} 加载失败: ${msg}`);
        }
      }
    },
  };
}
