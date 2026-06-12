/**
 * Self-Learning Loop — 自进化闭环控制器
 *
 * 完整闭环：工具使用追踪 → 模式检测 → 候选技能生成 → 晋升/降级
 * 自学习循环是可选的 — PolarClaw 在未启用时正常工作。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ILearningStore, IToolPattern } from '../../ports/learning.js';
import type { ISkillRegistry } from '../../ports/skills.js';
import { createSkillGenerator } from './skill-generator.js';

export interface ISelfLearningLoopConfig {
  skillsDir: string;
  candidatesDir: string;
  patternThreshold: number;
  promotionThreshold: number;
  demotionThreshold: number;
  cycleIntervalMs: number;
  enabled: boolean;
}

export const DEFAULT_LOOP_CONFIG: ISelfLearningLoopConfig = {
  skillsDir: 'PolarSkills',
  candidatesDir: 'PolarSkills/_candidates',
  patternThreshold: 5,
  promotionThreshold: 3,
  demotionThreshold: 3,
  cycleIntervalMs: 60_000,
  enabled: false,
};

export interface ICandidateRecord {
  id: string;
  name: string;
  patternName: string;
  createdAt: string;
  successCount: number;
  failureCount: number;
  status: 'candidate' | 'promoted' | 'demoted';
  demotionReason?: string;
}

export interface ILoopCycleResult {
  patternsAnalyzed: number;
  candidatesGenerated: number;
  promotions: string[];
  demotions: Array<{ id: string; reason: string }>;
}

export interface ISelfLearningLoop {
  readonly config: ISelfLearningLoopConfig;
  analyzeUsagePatterns(): IToolPattern[];
  generateCandidateSkill(pattern: IToolPattern): ICandidateRecord | null;
  promoteCandidateSkill(skillId: string): boolean;
  demoteSkill(skillId: string, reason: string): boolean;
  runCycle(): ILoopCycleResult;
  getCandidates(): ICandidateRecord[];
  getCandidate(skillId: string): ICandidateRecord | undefined;
  start(): void;
  stop(): void;
}

export function createSelfLearningLoop(
  learningStore: ILearningStore,
  skillRegistry: ISkillRegistry,
  partialConfig?: Partial<ISelfLearningLoopConfig>,
): ISelfLearningLoop {
  const config: ISelfLearningLoopConfig = { ...DEFAULT_LOOP_CONFIG, ...partialConfig };
  const candidates = new Map<string, ICandidateRecord>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const skillGenerator = createSkillGenerator({ outputDir: config.candidatesDir });

  loadCandidatesFromDisk();

  function loadCandidatesFromDisk(): void {
    if (!existsSync(config.candidatesDir)) return;
    for (const entry of readdirSync(config.candidatesDir)) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = readFileSync(join(config.candidatesDir, entry), 'utf-8');
        const rec: ICandidateRecord = JSON.parse(raw);
        if (rec.status === 'candidate') candidates.set(rec.id, rec);
      } catch { /* skip */ }
    }
  }

  function persistCandidate(rec: ICandidateRecord): void {
    if (!existsSync(config.candidatesDir)) mkdirSync(config.candidatesDir, { recursive: true });
    writeFileSync(join(config.candidatesDir, `${rec.id}.json`), JSON.stringify(rec, null, 2));
  }

  function removeCandidateFile(id: string): void {
    const fp = join(config.candidatesDir, `${id}.json`);
    try { if (existsSync(fp)) unlinkSync(fp); } catch { /* ok */ }
  }

  function analyzeUsagePatterns(): IToolPattern[] {
    return learningStore.findPatterns(config.patternThreshold);
  }

  function generateCandidateSkill(pattern: IToolPattern): ICandidateRecord | null {
    const existing = Array.from(candidates.values()).find(
      c => c.patternName === pattern.name && c.status === 'candidate',
    );
    if (existing) return null;
    const generated = skillGenerator.generateFromPattern(pattern);
    if (!generated) return null;
    const rec: ICandidateRecord = {
      id: generated.meta.name, name: generated.meta.name, patternName: pattern.name,
      createdAt: new Date().toISOString(), successCount: 0, failureCount: 0, status: 'candidate',
    };
    candidates.set(rec.id, rec);
    persistCandidate(rec);
    return rec;
  }

  function promoteCandidateSkill(skillId: string): boolean {
    const rec = candidates.get(skillId);
    if (!rec || rec.status !== 'candidate') return false;
    const useCount = learningStore.getSkillUseCount(skillId);
    if (useCount < config.promotionThreshold) return false;
    const skill = skillRegistry.getSkill(skillId);
    if (skill) { skill.status = 'verified'; skill.successfulUses = useCount; }
    rec.status = 'promoted';
    removeCandidateFile(skillId);
    candidates.delete(skillId);
    return true;
  }

  function demoteSkill(skillId: string, reason: string): boolean {
    const rec = candidates.get(skillId);
    if (rec) {
      rec.status = 'demoted'; rec.demotionReason = reason;
      removeCandidateFile(skillId); candidates.delete(skillId);
      return true;
    }
    const skill = skillRegistry.getSkill(skillId);
    if (!skill || skill.origin === 'static') return false;
    skillRegistry.unloadSkill(skillId);
    skill.status = 'retired';
    return true;
  }

  function runCycle(): ILoopCycleResult {
    if (!config.enabled) return { patternsAnalyzed: 0, candidatesGenerated: 0, promotions: [], demotions: [] };
    const patterns = analyzeUsagePatterns();
    const result: ILoopCycleResult = { patternsAnalyzed: patterns.length, candidatesGenerated: 0, promotions: [], demotions: [] };
    for (const pattern of patterns) {
      const rec = generateCandidateSkill(pattern);
      if (rec) result.candidatesGenerated++;
    }
    for (const [id, rec] of candidates.entries()) {
      if (rec.status !== 'candidate') continue;
      const useCount = learningStore.getSkillUseCount(id);
      rec.successCount = useCount;
      if (useCount >= config.promotionThreshold) {
        if (promoteCandidateSkill(id)) result.promotions.push(id);
        continue;
      }
      const skill = skillRegistry.getSkill(id);
      if (skill?.toolNames?.length) {
        let failures = 0;
        for (const toolName of skill.toolNames) {
          const history = learningStore.getUsageHistory('anonymous', toolName, 50);
          failures += history.filter(r => !r.success).length;
        }
        rec.failureCount = failures;
        if (failures >= config.demotionThreshold) {
          if (demoteSkill(id, `Exceeded failure threshold (${failures} failures)`)) {
            result.demotions.push({ id, reason: `Exceeded failure threshold (${failures} failures)` });
            continue;
          }
        }
      }
      persistCandidate(rec);
    }
    return result;
  }

  function getCandidates(): ICandidateRecord[] {
    return Array.from(candidates.values()).filter(c => c.status === 'candidate');
  }

  function getCandidate(skillId: string): ICandidateRecord | undefined {
    return candidates.get(skillId);
  }

  function start(): void {
    if (!config.enabled || timer) return;
    timer = setInterval(() => { try { runCycle(); } catch { /* non-critical */ } }, config.cycleIntervalMs);
  }

  function stop(): void {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { config, analyzeUsagePatterns, generateCandidateSkill, promoteCandidateSkill, demoteSkill, runCycle, getCandidates, getCandidate, start, stop };
}
