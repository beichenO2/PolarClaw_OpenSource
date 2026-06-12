/**
 * Skill Registry — 运行时技能管理 + 热加载
 *
 * 架构角色：
 * - 管理所有技能的完整生命周期（发现 → 加载 → 注册 → 卸载）
 * - 文件监听：skills 目录变更时自动重新加载
 * - 为后续 Phase（反馈学习、技能生成、技能组合）提供 CRUD 基础
 *
 * 与旧 skill-loader.ts 的关系：
 * skill-loader 被保留为底层扫描/解析工具，registry 在其上构建生命周期管理。
 */

import { watch, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { FSWatcher } from 'node:fs';
import type { ISkillRegistry, ISkillMeta, SkillEvent, SkillEventHandler } from '../../ports/skills.js';
import type { IToolExecutor } from '../../ports/tools.js';
import { createSkillLoader } from './skill-loader.js';

export interface ISkillRegistryConfig {
  /** 是否在 watch 时自动热加载（默认 true） */
  autoReload?: boolean;
  /** 文件变更后的防抖延迟 ms（默认 500） */
  debounceMs?: number;
}

export function createSkillRegistry(
  toolExecutor: IToolExecutor,
  config: ISkillRegistryConfig = {},
): ISkillRegistry {
  const { autoReload = true, debounceMs = 500 } = config;

  const loader = createSkillLoader();
  const loadedSkills = new Map<string, ISkillMeta>();
  /** skill name → 该技能注册的工具名列表 */
  const skillToolMap = new Map<string, string[]>();
  const eventHandlers = new Set<SkillEventHandler>();
  const watchers: FSWatcher[] = [];
  let watchDirs: string[] = [];
  let eagerMode = true;

  function emit(event: SkillEvent): void {
    for (const handler of eventHandlers) {
      try { handler(event); } catch { /* listener errors don't propagate */ }
    }
  }

  async function loadSingleSkill(skillDir: string): Promise<ISkillMeta | null> {
    const name = basename(skillDir);

    if (loadedSkills.has(name)) {
      unloadSingleSkill(name);
    }

    const scanned = loader.scan([join(skillDir, '..')]);
    const meta = scanned.find(s => s.name === name || basename(s.path, '/SKILL.md') === name);
    if (!meta) return null;

    const toolNames: string[] = [];
    await loader.registerTools([meta], (tool) => {
      toolExecutor.register(tool);
      toolNames.push(tool.name);
    });

    meta.toolNames = toolNames;
    meta.origin = meta.origin ?? 'static';
    loadedSkills.set(meta.name, meta);
    skillToolMap.set(meta.name, toolNames);

    return meta;
  }

  function unloadSingleSkill(name: string): boolean {
    const toolNames = skillToolMap.get(name);
    if (!toolNames) return false;

    for (const toolName of toolNames) {
      toolExecutor.unregister(toolName);
    }

    loadedSkills.delete(name);
    skillToolMap.delete(name);
    return true;
  }

  /** 带防抖的 reload，避免编辑器连续保存触发多次 */
  function createDebouncedReload() {
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    return (skillDir: string) => {
      const name = basename(skillDir);
      const existing = pending.get(name);
      if (existing) clearTimeout(existing);

      pending.set(name, setTimeout(async () => {
        pending.delete(name);
        try {
          if (!existsSync(join(skillDir, 'SKILL.md'))) {
            if (unloadSingleSkill(name)) {
              emit({ type: 'unloaded', skillName: name });
              console.error(`[SkillRegistry] 已卸载: ${name}`);
            }
            return;
          }

          if (!eagerMode && !loadedSkills.has(name)) {
            return;
          }

          const meta = await loadSingleSkill(skillDir);
          if (meta) {
            emit({ type: 'reloaded', skill: meta });
            console.error(`[SkillRegistry] 已热加载: ${meta.name} (${meta.toolNames?.length ?? 0} tools)`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          emit({ type: 'error', skillName: name, error: msg });
          console.error(`[SkillRegistry] 热加载失败 ${name}:`, msg);
        }
      }, debounceMs));
    };
  }

  const debouncedReload = createDebouncedReload();

  function watchPerSubdir(dir: string): void {
    if (!existsSync(dir)) return;
    const subdirs = readdirSync(dir);
    for (const entry of subdirs) {
      const skillDir = join(dir, entry);
      if (!statSync(skillDir).isDirectory()) continue;
      try {
        const watcher = watch(skillDir, () => {
          debouncedReload(skillDir);
        });
        watchers.push(watcher);
      } catch (err) {
        console.error(`[SkillRegistry] 逐目录监听失败 ${skillDir}:`, err);
      }
    }
    console.error(`[SkillRegistry] 逐目录监听: ${dir} (${subdirs.length} subdirs)`);
  }

  return {
    async init(scanDirs, options?: { loadTools?: boolean }) {
      watchDirs = scanDirs;
      const shouldLoad = options?.loadTools ?? true;
      eagerMode = shouldLoad;

      if (!shouldLoad) {
        console.error(`[SkillRegistry] 初始化完成 (仅扫描模式): 工具按需通过 skill_activate 加载`);
        return;
      }

      for (const dir of scanDirs) {
        if (!existsSync(dir)) continue;

        const entries = readdirSync(dir);
        for (const entry of entries) {
          if (entry === '_meta') continue;
          const skillDir = join(dir, entry);
          if (!statSync(skillDir).isDirectory()) continue;
          if (!existsSync(join(skillDir, 'SKILL.md'))) continue;

          try {
            const meta = await loadSingleSkill(skillDir);
            if (meta) {
              emit({ type: 'loaded', skill: meta });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            emit({ type: 'error', skillName: entry, error: msg });
            console.error(`[SkillRegistry] 加载失败 ${entry}:`, msg);
          }
        }
      }

      console.error(`[SkillRegistry] 初始化完成: ${loadedSkills.size} 技能, ${Array.from(skillToolMap.values()).reduce((a, b) => a + b.length, 0)} 工具`);
    },

    watch() {
      if (!autoReload) return;

      const useRecursive = process.platform === 'darwin';
      if (!useRecursive) {
        console.error(`[SkillRegistry] 平台 ${process.platform} 可能不支持 recursive watch，将逐目录监听`);
      }

      for (const dir of watchDirs) {
        if (!existsSync(dir)) continue;

        if (useRecursive) {
          try {
            const watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
              if (!filename) return;
              const skillName = filename.split('/')[0] ?? filename;
              const skillDir = join(dir, skillName);
              if (existsSync(skillDir) && statSync(skillDir).isDirectory()) {
                debouncedReload(skillDir);
              }
            });
            watchers.push(watcher);
            console.error(`[SkillRegistry] 监听: ${dir}`);
          } catch (err: unknown) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
              console.error(`[SkillRegistry] recursive watch 不可用，回退逐目录模式: ${dir}`);
              watchPerSubdir(dir);
            } else {
              console.error(`[SkillRegistry] 监听失败 ${dir}:`, err);
            }
          }
        } else {
          watchPerSubdir(dir);
        }
      }
    },

    unwatch() {
      for (const w of watchers) {
        try { w.close(); } catch { /* ignore */ }
      }
      watchers.length = 0;
    },

    async loadSkill(skillDir) {
      try {
        const meta = await loadSingleSkill(skillDir);
        if (meta) {
          emit({ type: 'loaded', skill: meta });
          console.error(`[SkillRegistry] 手动加载: ${meta.name}`);
        }
        return meta;
      } catch (err) {
        const name = basename(skillDir);
        const msg = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', skillName: name, error: msg });
        return null;
      }
    },

    unloadSkill(skillName) {
      const result = unloadSingleSkill(skillName);
      if (result) {
        emit({ type: 'unloaded', skillName });
        console.error(`[SkillRegistry] 手动卸载: ${skillName}`);
      }
      return result;
    },

    listSkills() {
      return Array.from(loadedSkills.values());
    },

    getSkill(name) {
      return loadedSkills.get(name);
    },

    on(handler) {
      eventHandlers.add(handler);
    },

    off(handler) {
      eventHandlers.delete(handler);
    },

    onSkillLoaded(callback) {
      eventHandlers.add((event) => {
        if (event.type === 'loaded' || event.type === 'reloaded') {
          callback(event.skill);
        }
      });
    },

    onSkillUnloaded(callback) {
      eventHandlers.add((event) => {
        if (event.type === 'unloaded') {
          callback(event.skillName);
        }
      });
    },
  };
}
