/**
 * 上下文压缩适配器 — 三阶段渐进式压缩
 *
 * 实现 IContextCompressor 接口。
 * 按需逐级触发，越高阶段压缩比越大但信息损失越多：
 *
 * Phase 1: 结构化裁剪
 *   - 截断工具调用的长输出（只保留前 N 字符 + 摘要标记）
 *   - 移除连续重复的系统消息
 *
 * Phase 2: 头尾保护 + 中间段折叠
 *   - 保留前 K 条和后 K 条消息（上下文锚点）
 *   - 中间消息合并为 "[已压缩 N 条消息]" 占位
 *
 * Phase 3: LLM 摘要（可选，需注入 summarize 函数）
 *   - 将中间段用轻量模型生成结构化摘要
 *   - 摘要保留关键事实、决策、工具结果
 */

import type { IContextCompressor } from '../../ports/compression.js';
import type { IChatMessage } from '../../ports/memory.js';

export interface ICompressorConfig {
  /** 触发压缩的 token 占比阈值（默认 0.7，即 70% 预算时触发） */
  triggerRatio?: number;
  /** Phase 1：工具输出截断到多少字符（默认 2000） */
  toolOutputMaxLen?: number;
  /** Phase 2：头部保留多少条消息（默认 4） */
  headKeep?: number;
  /** Phase 2：尾部保留多少条消息（默认 8） */
  tailKeep?: number;
  /** Phase 3：LLM 摘要函数（不提供则跳过 Phase 3） */
  summarize?: (text: string) => Promise<string>;
}

/** 粗略 token 估算 */
function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const nonCjk = text.length - cjkChars;
  return Math.ceil(cjkChars * 1.5 + nonCjk * 0.3);
}

function totalTokens(messages: IChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
}

export function createContextCompressor(config: ICompressorConfig = {}): IContextCompressor {
  const triggerRatio = config.triggerRatio ?? 0.7;
  const toolOutputMaxLen = config.toolOutputMaxLen ?? 2000;
  const headKeep = config.headKeep ?? 4;
  const tailKeep = config.tailKeep ?? 8;
  const summarize = config.summarize;

  return {
    shouldCompress(messages, budgetTokens) {
      return totalTokens(messages) > budgetTokens * triggerRatio;
    },

    async compress(messages, budgetTokens) {
      const originalTokenCount = totalTokens(messages);
      const phasesUsed: number[] = [];
      let compressed = [...messages];

      // ── Phase 1: 结构化裁剪（工具输出截断） ──
      compressed = compressed.map(m => {
        if (m.role === 'tool' && m.content.length > toolOutputMaxLen) {
          return {
            ...m,
            content: `${m.content.slice(0, toolOutputMaxLen)}\n…[工具输出已截断，原长 ${m.content.length} 字符]`,
          };
        }
        return m;
      });

      let currentTokens = totalTokens(compressed);
      if (currentTokens <= budgetTokens * 0.85) {
        phasesUsed.push(1);
        return {
          messages: compressed,
          originalTokens: originalTokenCount,
          compressedTokens: currentTokens,
          phasesUsed,
        };
      }
      phasesUsed.push(1);

      // ── Phase 2: 头尾保护 + 中间段折叠 ──
      if (compressed.length > headKeep + tailKeep + 2) {
        const head = compressed.slice(0, headKeep);
        const tail = compressed.slice(-tailKeep);
        const middle = compressed.slice(headKeep, -tailKeep);

        const middleRoles = middle.reduce((acc, m) => {
          acc[m.role] = (acc[m.role] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const rolesSummary = Object.entries(middleRoles)
          .map(([role, count]) => `${role}:${count}`)
          .join(', ');

        const keyFacts: string[] = [];
        for (const m of middle) {
          if (m.role === 'user') {
            keyFacts.push(`- 用户: ${m.content.slice(0, 100)}`);
          } else if (m.role === 'assistant' && m.toolCalls?.length) {
            const toolNames = m.toolCalls.map(tc => tc.function.name).join(', ');
            keyFacts.push(`- 调用工具: ${toolNames}`);
          }
        }

        const foldedContent = [
          `[已压缩 ${middle.length} 条中间消息 (${rolesSummary})]`,
          keyFacts.length > 0 ? `关键事件:\n${keyFacts.slice(0, 10).join('\n')}` : '',
        ].filter(Boolean).join('\n');

        compressed = [
          ...head,
          { role: 'system' as const, content: foldedContent },
          ...tail,
        ];

        currentTokens = totalTokens(compressed);
        if (currentTokens <= budgetTokens * 0.85) {
          phasesUsed.push(2);
          return {
            messages: compressed,
            originalTokens: originalTokenCount,
            compressedTokens: currentTokens,
            phasesUsed,
          };
        }
        phasesUsed.push(2);
      }

      // ── Phase 3: LLM 摘要（需注入 summarize 函数） ──
      if (summarize && compressed.length > headKeep + tailKeep + 2) {
        const head = compressed.slice(0, headKeep);
        const tail = compressed.slice(-tailKeep);
        const middle = compressed.slice(headKeep, -tailKeep);

        const middleText = middle.map(m =>
          `[${m.role}] ${m.content.slice(0, 500)}`
        ).join('\n---\n');

        try {
          const summary = await summarize(middleText);
          compressed = [
            ...head,
            { role: 'system' as const, content: `[对话摘要]\n${summary}` },
            ...tail,
          ];
          phasesUsed.push(3);
        } catch (err) {
          console.error('[Compression] Phase 3 摘要失败，使用 Phase 2 结果:', err);
        }
      }

      return {
        messages: compressed,
        originalTokens: originalTokenCount,
        compressedTokens: phasesUsed.includes(3) ? totalTokens(compressed) : currentTokens,
        phasesUsed,
      };
    },
  };
}
