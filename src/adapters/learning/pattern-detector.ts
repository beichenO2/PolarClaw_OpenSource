/**
 * Pattern Detector — 工具调用模式识别
 *
 * 从工具使用历史中检测重复出现的多步调用序列。
 * 当某个序列出现次数达到阈值时，标记为可提升为技能的候选模式。
 *
 * 算法：滑动窗口 + 序列哈希 → 频率统计
 */

import type { ILearningStore, IToolPattern, IToolUsageRecord, IArrowLogRecord } from '../../ports/learning.js';

export interface IPatternDetectorConfig {
  /** 最小序列长度（默认 2） */
  minSequenceLen?: number;
  /** 最大序列长度（默认 5） */
  maxSequenceLen?: number;
  /** 同一会话中两次调用间的最大间隔 ms（超过视为不连续，默认 60s） */
  maxGapMs?: number;
  /** 达到此出现次数则视为模式（默认 3） */
  promotionThreshold?: number;
}

interface ToolStep {
  tool: string;
  argsKeys: string[];
}

/** Arrow log 模式（高命中率 delta 模式） */
export interface IArrowPattern {
  name: string;
  /** delta 模式（可能包含占位符） */
  deltaPattern: string;
  /** 命中率 */
  hitRate: number;
  /** 总出现次数 */
  occurrences: number;
  /** 命中次数 */
  hits: number;
  /** 关联的 target 类型（可选） */
  targetType?: string;
}

export function createPatternDetector(
  learningStore: ILearningStore,
  config: IPatternDetectorConfig = {},
) {
  const {
    minSequenceLen = 2,
    maxSequenceLen = 5,
    maxGapMs = 60_000,
    promotionThreshold = 3,
  } = config;

  function extractSequences(records: IToolUsageRecord[]): ToolStep[][] {
    const sorted = [...records].sort(
      (a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
    );

    const sessions: IToolUsageRecord[][] = [];
    let current: IToolUsageRecord[] = [];

    for (const record of sorted) {
      if (!record.success) continue;

      if (current.length > 0) {
        const lastTime = new Date(current[current.length - 1]!.createdAt!).getTime();
        const thisTime = new Date(record.createdAt!).getTime();
        if (thisTime - lastTime > maxGapMs) {
          if (current.length >= minSequenceLen) sessions.push(current);
          current = [];
        }
      }
      current.push(record);
    }
    if (current.length >= minSequenceLen) sessions.push(current);

    const sequences: ToolStep[][] = [];
    for (const session of sessions) {
      for (let len = minSequenceLen; len <= Math.min(maxSequenceLen, session.length); len++) {
        for (let start = 0; start <= session.length - len; start++) {
          const seq = session.slice(start, start + len).map(r => ({
            tool: r.toolName,
            argsKeys: safeParseKeys(r.args),
          }));
          sequences.push(seq);
        }
      }
    }

    return sequences;
  }

  function sequenceKey(seq: ToolStep[]): string {
    return seq.map(s => `${s.tool}(${s.argsKeys.sort().join(',')})`).join(' → ');
  }

  return {
    /**
     * 分析指定用户的工具使用历史，检测重复模式。
     * 返回新发现的模式列表（已自动保存到 store）。
     */
    detect(userId: string): IToolPattern[] {
      const allTools = new Set<string>();
      const history: IToolUsageRecord[] = [];

      // 从每个工具获取历史
      // 先拿所有 usage 获取工具名，再按工具查
      // 为了效率，直接读取全部 usage 并过滤
      const toolNames = getDistinctToolNames(userId);
      for (const toolName of toolNames) {
        allTools.add(toolName);
        history.push(...learningStore.getUsageHistory(userId, toolName, 100));
      }

      if (history.length < minSequenceLen) return [];

      const sequences = extractSequences(history);
      const freq = new Map<string, { count: number; steps: ToolStep[]; trigger: string }>();

      for (const seq of sequences) {
        const key = sequenceKey(seq);
        const existing = freq.get(key);
        if (existing) {
          existing.count++;
        } else {
          freq.set(key, {
            count: 1,
            steps: seq,
            trigger: inferTrigger(seq),
          });
        }
      }

      const newPatterns: IToolPattern[] = [];

      for (const [_key, data] of freq) {
        if (data.count < promotionThreshold) continue;

        const name = generatePatternName(data.steps);
        const pattern: IToolPattern = {
          name,
          sequence: JSON.stringify(data.steps),
          trigger: data.trigger,
          occurrences: data.count,
          promoted: false,
        };

        learningStore.savePattern(pattern);
        newPatterns.push(pattern);
      }

      return newPatterns;
    },

    /** 获取当前可提升的模式 */
    getCandidates(): IToolPattern[] {
      return learningStore.findPatterns(promotionThreshold);
    },

    /**
     * 从 arrow_logs 检测高命中率的 delta 模式。
     * 分析 hit/miss 与 delta 的相关性，识别"什么样的改动更容易命中目标"。
     */
    detectFromArrowLogs(projectId: string): IArrowPattern[] {
      const logs = learningStore.getArrowLogs(projectId, 500);
      if (logs.length < promotionThreshold) return [];

      // 按 delta 分组统计 hit/miss
      const deltaStats = new Map<string, { hits: number; misses: number; deltas: string[] }>();

      for (const log of logs) {
        // 对 delta 做简单归一化（去除具体值，保留结构）
        const normalizedDelta = normalizeDelta(log.delta);

        const existing = deltaStats.get(normalizedDelta);
        if (existing) {
          if (log.outcome === 'hit') {
            existing.hits++;
          } else {
            existing.misses++;
          }
          existing.deltas.push(log.delta);
        } else {
          deltaStats.set(normalizedDelta, {
            hits: log.outcome === 'hit' ? 1 : 0,
            misses: log.outcome === 'miss' ? 1 : 0,
            deltas: [log.delta],
          });
        }
      }

      const patterns: IArrowPattern[] = [];

      for (const [normalizedDelta, stats] of deltaStats) {
        const total = stats.hits + stats.misses;
        if (total < promotionThreshold) continue;

        const hitRate = stats.hits / total;
        // 只保留命中率 > 50% 的模式
        if (hitRate <= 0.5) continue;

        patterns.push({
          name: generateArrowPatternName(normalizedDelta),
          deltaPattern: normalizedDelta,
          hitRate,
          occurrences: total,
          hits: stats.hits,
        });
      }

      // 按命中率降序排列
      return patterns.sort((a, b) => b.hitRate - a.hitRate);
    },
  };

  function getDistinctToolNames(userId: string): string[] {
    return learningStore.getDistinctToolNames(userId);
  }
}

function safeParseKeys(json: string): string[] {
  try {
    const obj = JSON.parse(json);
    return typeof obj === 'object' && obj !== null ? Object.keys(obj) : [];
  } catch {
    return [];
  }
}

function inferTrigger(steps: { tool: string }[]): string {
  const tools = steps.map(s => s.tool);
  if (tools.some(t => t.includes('get')) && tools.some(t => t.includes('create'))) {
    return '查询后创建';
  }
  if (tools.every(t => t.includes('get'))) {
    return '多源数据聚合';
  }
  return `${tools.length} 步工具序列`;
}

function generatePatternName(steps: { tool: string }[]): string {
  const verbs = steps.map(s => {
    const parts = s.tool.split('_');
    return parts.length > 1 ? parts[1] : parts[0];
  });
  return verbs.join('-then-');
}

/**
 * 归一化 delta 字符串，提取结构模式。
 * 例如："修改了 src/foo.ts 的 bar 函数" → "修改了 {file} 的 {function}"
 */
function normalizeDelta(delta: string): string {
  // 简单实现：替换路径、数字、引号内容为占位符
  let normalized = delta;

  // 替换文件路径（常见模式）
  normalized = normalized.replace(/src\/[\w/.-]+/g, '{file}');
  normalized = normalized.replace(/\b[\w-]+\.ts\b/g, '{file}');
  normalized = normalized.replace(/\b[\w-]+\.js\b/g, '{file}');

  // 替换数字
  normalized = normalized.replace(/\b\d+\b/g, '{n}');

  // 替换引号内容
  normalized = normalized.replace(/'[^']*'/g, "'{str}'");
  normalized = normalized.replace(/"[^"]*"/g, '"{str}"');

  // 替换函数名/变量名（驼峰命名）
  normalized = normalized.replace(/\b[a-z][a-zA-Z0-9]*\b/g, '{name}');

  return normalized;
}

/**
 * 从归一化的 delta 生成模式名称
 */
function generateArrowPatternName(normalizedDelta: string): string {
  // 提取关键动词
  if (normalizedDelta.includes('修改')) return 'modify-pattern';
  if (normalizedDelta.includes('新增')) return 'add-pattern';
  if (normalizedDelta.includes('删除')) return 'delete-pattern';
  if (normalizedDelta.includes('重构')) return 'refactor-pattern';
  if (normalizedDelta.includes('修复')) return 'fix-pattern';

  // 默认使用前 20 个字符
  const short = normalizedDelta.slice(0, 20).replace(/\s+/g, '-');
  return `delta-${short}`;
}
