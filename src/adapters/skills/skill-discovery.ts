/**
 * Skill Discovery — Agent 工具：搜索、激活、停用技能
 *
 * 实现"理论上无限 Skills"的核心机制：
 * - skill_search: 搜索可用技能（本地 + 生态项目）
 * - skill_activate: 按需加载技能工具到执行器
 * - skill_deactivate: 卸载不需要的技能释放上下文
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { IToolHandler } from '../../ports/tools.js';
import type { ISkillRegistry, ISkillIndexEntry } from '../../ports/skills.js';
import type { IMetaIndex } from './meta-index.js';
import { buildSkillRulesAppend } from '../../rules/runtime-inject.js';
import { setActiveSkillRules, clearActiveSkillRules } from '../../rules/active-skills.js';

export interface ISkillDiscoveryDeps {
  metaIndex: IMetaIndex;
  skillRegistry: ISkillRegistry;
  /** Polarisor 根目录（用于生态搜索） */
  polarisorRoot: string;
  /** 本项目 skills 目录列表 */
  localSkillDirs: string[];
}

export function createSkillDiscoveryTools(deps: ISkillDiscoveryDeps): IToolHandler[] {
  const { metaIndex, skillRegistry, polarisorRoot, localSkillDirs } = deps;

  /** 扫描 Polarisor 生态中其他项目的 skills/ 目录 */
  function scanEcosystemSkills(): ISkillIndexEntry[] {
    const entries: ISkillIndexEntry[] = [];
    if (!existsSync(polarisorRoot)) return entries;

    const SKIP = new Set(['node_modules', '.git', 'dist', 'Showcase', '.planning']);

    for (const project of readdirSync(polarisorRoot)) {
      const projectDir = join(polarisorRoot, project);
      if (!statSync(projectDir).isDirectory()) continue;
      if (SKIP.has(project)) continue;

      let skillsDir = join(projectDir, 'PolarSkills');
      if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
        skillsDir = join(projectDir, 'skills');
        if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) continue;
      }

      const isLocal = localSkillDirs.some(d => d === skillsDir || d.startsWith(skillsDir));
      if (isLocal) continue;

      for (const entry of readdirSync(skillsDir)) {
        const skillDir = join(skillsDir, entry);
        if (!statSync(skillDir).isDirectory()) continue;
        if (!existsSync(join(skillDir, 'SKILL.md'))) continue;

        entries.push({
          name: `${project}/${entry}`,
          description: `[${project}] ${entry}`,
          toolNames: [],
          origin: 'static',
          status: 'verified',
          activated: false,
          skillDir,
        });
      }
    }

    return entries;
  }

  const skillSearch: IToolHandler = {
    name: 'skill_search',
    description:
      '搜索可用技能。source=local 搜索本项目技能，source=ecosystem 搜索 Polarisor 生态下所有项目的技能。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词（匹配技能名、描述、工具名）' },
        source: {
          type: 'string',
          enum: ['local', 'ecosystem', 'all'],
          description: '搜索范围：local=本项目, ecosystem=生态项目, all=全部（默认 all）',
        },
      },
      required: ['query'],
    },
    handler(args) {
      const query = String(args.query ?? '').toLowerCase();
      const source = String(args.source ?? 'all');
      const results: Array<ISkillIndexEntry & { source: string }> = [];

      if (source === 'local' || source === 'all') {
        const local = metaIndex.search(query);
        for (const entry of local) {
          results.push({ ...entry, source: 'local' });
        }
      }

      if (source === 'ecosystem' || source === 'all') {
        const eco = scanEcosystemSkills();
        for (const entry of eco) {
          if (
            entry.name.toLowerCase().includes(query) ||
            entry.description.toLowerCase().includes(query)
          ) {
            results.push({ ...entry, source: 'ecosystem' });
          }
        }
      }

      return {
        results: results.map(r => ({
          name: r.name,
          description: r.description,
          tools: r.toolNames,
          status: r.status,
          activated: r.activated,
          source: (r as any).source,
        })),
        total: results.length,
      };
    },
  };

  const skillActivate: IToolHandler = {
    name: 'skill_activate',
    description:
      '按需加载指定技能的工具。加载后该技能的工具立即可用。先用 skill_search 找到技能名再调用。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名称' },
      },
      required: ['name'],
    },
    async handler(args) {
      const name = String(args.name ?? '');
      if (!name) return { ok: false, error: '请提供技能名称' };

      const existing = skillRegistry.getSkill(name);
      if (existing) {
        return {
          ok: true,
          already_active: true,
          skill: name,
          tools: existing.toolNames ?? [],
        };
      }

      const entry = metaIndex.get(name);
      if (!entry) {
        return { ok: false, error: `技能 "${name}" 未在索引中找到，请先用 skill_search 搜索` };
      }

      const loaded = await skillRegistry.loadSkill(entry.skillDir);
      if (!loaded) {
        return { ok: false, error: `技能 "${name}" 加载失败` };
      }

      metaIndex.markActivated(name, loaded.toolNames ?? []);
      console.error(`[SkillDiscovery] 按需激活: ${name} (${loaded.toolNames?.length ?? 0} 工具)`);

      const injectedRules = buildSkillRulesAppend(name);
      if (injectedRules) setActiveSkillRules(name, injectedRules);

      return {
        ok: true,
        skill: loaded.name,
        tools: loaded.toolNames ?? [],
        description: loaded.description,
        ...(injectedRules ? { injected_rules: injectedRules } : {}),
      };
    },
  };

  const skillDeactivate: IToolHandler = {
    name: 'skill_deactivate',
    description: '卸载不再需要的技能，释放其注册的工具。核心工具（memory/learning/yolo）不可卸载。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要卸载的技能名称' },
      },
      required: ['name'],
    },
    handler(args) {
      const name = String(args.name ?? '');
      if (!name) return { ok: false, error: '请提供技能名称' };

      const PROTECTED = new Set(['core-tools', 'learning-tools']);
      if (PROTECTED.has(name)) {
        return { ok: false, error: `技能 "${name}" 是核心技能，不可卸载` };
      }

      const result = skillRegistry.unloadSkill(name);
      if (!result) {
        return { ok: false, error: `技能 "${name}" 当前未激活` };
      }

      metaIndex.markDeactivated(name);
      clearActiveSkillRules(name);
      console.error(`[SkillDiscovery] 已停用: ${name}`);
      return { ok: true, deactivated: name };
    },
  };

  return [skillSearch, skillActivate, skillDeactivate];
}
