/**
 * PolarClaw Agent Core — 核心 Agent 循环
 *
 * 端口-适配器架构的核心层：
 * - 只依赖 ports/ 中的接口
 * - 通过依赖注入接收所有适配器
 * - 实现多轮对话（修复旧版单轮无状态的关键差距）
 *
 * 消息流：
 * Channel → PrivacyGateway.sanitize → AgentLoop → PrivacyGateway.desanitize → Channel
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { IPrivacyGateway } from '../ports/privacy.js';
import type { IMemoryStore, IConversationHistory, IChatMessage } from '../ports/memory.js';
import type { ILLMRouter, ILLMResponse, ILLMStreamDelta } from '../ports/llm.js';
import type { IToolExecutor } from '../ports/tools.js';
import type { IContextCompressor } from '../ports/compression.js';
import type { SessionMemoryManager } from '../memory/SessionMemory.js';
import { acquireLock, releaseLock } from '../sdk/project-lock.js';
import {
  type TaskContract,
  extractContractFromMessage,
  createContract,
  buildContractInjection,
  isSimpleContract,
  serializeContract,
  deserializeContract,
} from './task-contract.js';
import { loadEcoConstraints } from './eco-constraints.js';

export type AgentProgressEvent =
  | { type: 'thinking'; round: number; model?: string; message_count?: number }
  | { type: 'reasoning'; round: number; delta: string }
  | { type: 'content'; round: number; delta: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; call_id?: string; timestamp?: string }
  | { type: 'tool_result'; tool: string; result: string; call_id?: string; success?: boolean; duration_ms?: number }
  | { type: 'chunk'; content: string }
  | { type: 'contract'; contract: TaskContract }
  | { type: 'done'; content: string; model?: string };

/**
 * 单轮对话级运行时选项（来自 Chat 面板，覆盖默认配置）。
 * 全部可选，未提供时回落到 IAgentConfig / 路由器自动选型，保持向后兼容。
 */
export interface IAgentRuntimeOptions {
  /** 工具调用轮使用的 QCSA 能力码（工具调用模型） */
  toolCapability?: string;
  /** 首轮思考使用的 QCSA 能力码（思考模型）；未设置则与工具模型一致 */
  thinkingCapability?: string;
  /** 本轮覆盖的最大工具调用轮数（最大循环次数）；<=0 视为无限 */
  maxRounds?: number;
  /** RetryLoop 模式：开启后对限流/瞬时错误做有界退避重试 */
  retryLoop?: boolean;
}

export interface IPersonaResult {
  content: string;
  allowedSkills?: string[];
}

export interface IAgentConfig {
  /** 工具调用安全上限（0 = 无限制，由压缩器管理上下文） */
  maxToolRounds: number;
  /** system prompt（基础部分，persona 会追加到末尾） */
  systemPrompt: string;
  /** 技能目录文本（独立于 systemPrompt，按 persona 可过滤） */
  skillCatalog?: string;
  /** 按 userId 返回 persona 内容和可用技能列表 */
  personaResolver?: (userId: string) => IPersonaResult;
  /** 温度 */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
  /** 工具输出截断长度 */
  maxToolOutputLength?: number;
  /** 强制工具调用（设为 true 时，tool_choice 设为 required） */
  forceToolCall?: boolean;
}

export interface IAgentDeps {
  llm: ILLMRouter;
  memory: IMemoryStore;
  conversations: IConversationHistory;
  tools: IToolExecutor;
  privacy: IPrivacyGateway;
  /** 上下文压缩器（可选，不提供则不启用压缩） */
  compressor?: IContextCompressor;
  /** 运行时记忆管理器（可选，Phase 3 新增） */
  sessionMemory?: SessionMemoryManager;
}

export interface IAgentResponse {
  /** Agent 回复（已还原隐私） */
  text: string;
  /** 是否被隐私网关拦截 */
  blocked: boolean;
  /** 拦截警告 */
  warning?: string;
  /** token 使用统计 */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

function filterSkillCatalog(catalog: string | undefined, allowedSkills: string[] | undefined): string {
  if (!catalog) return '';
  if (!allowedSkills) return catalog;
  const allowed = new Set(allowedSkills.map(s => s.toLowerCase()));
  return catalog.split('\n').filter(line => {
    const skillMatch = line.match(/^- (?:[✅📝⏸️] )?(?:\*\*)?([^*:]+?)(?:\*\*)?:\s/);
    if (!skillMatch) return true;
    return allowed.has(skillMatch[1]!.trim().toLowerCase());
  }).join('\n');
}

export function createAgent(config: IAgentConfig, deps: IAgentDeps) {
  const { llm, memory, conversations, tools, privacy, compressor, sessionMemory } = deps;
  const maxToolOutputLen = config.maxToolOutputLength ?? 12000;

  const memoryContextCache = new Map<string, { context: string; ts: number }>();
  const MEMORY_CACHE_TTL_MS = 1000;

  /** Active TaskContracts per conversation */
  const activeContracts = new Map<string, TaskContract>();

  /**
   * 处理用户消息（完整流程）
   *
   * @param channel 通道名称
   * @param userId 用户 ID
   * @param text 用户消息原文
   * @param conversationId 对话 ID（同一对话共享上下文）
   */
  async function handleMessage(
    channel: string,
    userId: string,
    text: string,
    conversationId?: string,
    projectId?: string,
    onProgress?: (event: AgentProgressEvent) => void,
    runtime?: IAgentRuntimeOptions,
  ): Promise<IAgentResponse> {
    const convId = conversationId ?? `${channel}:${userId}`;
    const holder = projectId ? `agent/solo-${userId}` : '';

    // Acquire project lock if projectId provided (Solo Agent task)
    if (projectId) {
      const acquired = acquireLock(projectId, holder, 'solo-agent-task');
      if (!acquired) {
        return {
          text: '⚠️ 项目已被其他任务锁定，请稍后再试。',
          blocked: true,
          warning: `project lock held by another task`,
        };
      }
    }

    try {
      const sanitizeResult = await privacy.sanitize(userId, text);
      if (sanitizeResult.blocked) {
        return {
          text: sanitizeResult.warning ?? '⚠️ 消息被隐私网关拦截',
          blocked: true,
          warning: sanitizeResult.warning,
        };
      }

      const sanitizedText = sanitizeResult.sanitized;

      memory.saveProfile(userId, 'lastActiveAt', new Date().toISOString());
      memory.saveProfile(userId, 'lastChannel', channel);

      const memoryContext = buildMemoryContext(userId, sanitizedText);

      const userContent = memoryContext
        ? `${memoryContext}\n\n${sanitizedText}`
        : sanitizedText;

      conversations.append(convId, { role: 'user', content: userContent });

      const existingHistory = conversations.getHistory(convId);
      const isOngoing = existingHistory.length > 2;

      let sessionMemoryPrefix = '';
      if (sessionMemory) {
        const longTermBlocks = await sessionMemory.fetchLongTermMemory(sanitizedText, userId);
        if (longTermBlocks.length > 0) {
          const session = sessionMemory.getOrCreateSession(convId);
          session.longTermBlocks = longTermBlocks;
        }
        sessionMemoryPrefix = sessionMemory.buildMemoryInjection(convId);
      }

      // TaskContract: load from cache → SQLite → extract from message
      let contract = activeContracts.get(convId);
      if (!contract && sessionMemory) {
        const stored = sessionMemory.loadContract(convId);
        if (stored) {
          contract = deserializeContract(stored) ?? undefined;
          if (contract) activeContracts.set(convId, contract);
        }
      }
      if (!contract) {
        try {
          const simpleLlmChat = async (
            msgs: Array<{ role: string; content: string }>,
            opts?: { capability?: string },
          ) => {
            const formatted: IChatMessage[] = msgs.map(m => ({
              role: m.role as IChatMessage['role'],
              content: m.content,
            }));
            const res = await llm.chat(formatted, { capability: opts?.capability });
            return { content: res.content };
          };
          const extracted = await extractContractFromMessage(sanitizedText, simpleLlmChat);
          const ecoConstraints = loadEcoConstraints(sanitizedText);
          contract = createContract(extracted, ecoConstraints);
          activeContracts.set(convId, contract);
          if (sessionMemory) {
            sessionMemory.saveContract(convId, serializeContract(contract));
          }
          if (!isSimpleContract(contract)) {
            console.error(`[Agent] TaskContract created: ${contract.constraints.length} user + ${contract.ecoConstraints.length} eco constraints, ${contract.steps.length} steps`);
            onProgress?.({ type: 'contract', contract });
          }
        } catch (err) {
          console.error('[Agent] TaskContract extraction failed, proceeding without contract:', err);
        }
      }

      const result = await runLoop(convId, userId, isOngoing, sessionMemoryPrefix, contract, onProgress, runtime);

      const rawText = result.text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
      const responseText = privacy.desanitize(userId, rawText || result.text);
      const responseUsage = result.usage;

      setImmediate(() => {
        if (sessionMemory) {
          const currentHistory = conversations.getHistory(convId);
          sessionMemory.updateWorkingMemory(convId, currentHistory);
          sessionMemory.compressForNextTurn(convId).catch((err) => {
            console.error(`[Agent] session memory compression failed:`, err);
          });
        }
        if (responseUsage) {
          try { persistUsage(userId, channel, responseUsage, result.model, convId); } catch { /* non-fatal */ }
        }
      });

      return {
        text: responseText,
        blocked: false,
        usage: responseUsage,
      };
    } finally {
      if (projectId) {
        releaseLock(projectId, holder);
      }
    }
  }

  /** 构建注入的记忆上下文（用户画像 + FTS 相关记忆），带短窗口缓存避免高频消息重复查询 */
  function buildMemoryContext(userId: string, queryText: string): string {
    if (userId === 'anonymous') return '';

    const cacheKey = `${userId}:${queryText.slice(0, 60)}`;
    const cached = memoryContextCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MEMORY_CACHE_TTL_MS) {
      return cached.context;
    }

    const lines: string[] = [];

    // 用户画像
    const profiles = memory.getAllProfiles(userId);
    const prefs = profiles.filter(p => !p.key.startsWith('last'));
    if (prefs.length > 0) {
      lines.push('**用户画像**');
      for (const p of prefs.slice(0, 15)) {
        lines.push(`- ${p.key}: ${(p.value ?? '').slice(0, 200)}`);
      }
    }

    // FTS 搜索相关记忆（按 userId 隔离）
    const query = queryText.trim().slice(0, 120);
    if (query.length >= 2) {
      const result = memory.search(query, { limit: 5, userId });
      if (result.entries.length > 0) {
        lines.push('**相关记忆**');
        for (const entry of result.entries) {
          lines.push(`- [${entry.type}] ${entry.content.slice(0, 300)}`);
        }
      }
    }

    if (lines.length === 0) {
      memoryContextCache.set(cacheKey, { context: '', ts: Date.now() });
      return '';
    }
    const context = `## 长期记忆（自动注入）\n${lines.join('\n')}`;
    memoryContextCache.set(cacheKey, { context, ts: Date.now() });
    return context;
  }

  /** Agent 主循环：system + 历史消息 → LLM → 工具调用 → 观察 → 重复 */
  async function runLoop(
    convId: string,
    userId: string,
    isOngoing = false,
    sessionMemoryPrefix = '',
    contract?: TaskContract,
    onProgress?: (event: AgentProgressEvent) => void,
    runtime?: IAgentRuntimeOptions,
  ): Promise<{ text: string; usage?: ILLMResponse['usage']; model?: string }> {
    let totalUsage: NonNullable<ILLMResponse['usage']> | undefined;
    let lastModel = '';
    let emptyNudges = 0;

    // Track repeated futile tool calls to prevent search loops
    const futileCallCounts = new Map<string, number>();
    const FUTILE_CALL_LIMIT = 2;

    // 上下文压缩的 token 预算（留 20% 余量给 system prompt + 输出）
    const compressionBudget = (config.maxTokens ?? 4096) * 12;

    const personaResult = config.personaResolver?.(userId);
    const personaText = personaResult?.content ?? '';
    const catalog = filterSkillCatalog(config.skillCatalog, personaResult?.allowedSkills);
    const basePrompt = [config.systemPrompt, catalog, personaText].filter(Boolean).join('\n\n');

    // 最大循环次数：面板覆盖 > 配置；>0 用其值，==0 视为无限，<0 回落 10。
    const effectiveMaxRounds = runtime?.maxRounds != null ? runtime.maxRounds : config.maxToolRounds;
    const maxRounds = effectiveMaxRounds > 0
      ? effectiveMaxRounds
      : effectiveMaxRounds === 0 ? Infinity : 10;
    for (let round = 0; round < maxRounds; round++) {
      const history = conversations.getHistory(convId);
      let contextMessages = history;

      // 上下文压缩：对话历史接近预算时渐进式压缩
      if (compressor && compressor.shouldCompress(contextMessages, compressionBudget)) {
        const result = await compressor.compress(contextMessages, compressionBudget);
        contextMessages = result.messages;
        if (result.phasesUsed.length > 0) {
          console.error(
            `[Compression] ${result.originalTokens} → ${result.compressedTokens} tokens` +
            ` (phases: ${result.phasesUsed.join(',')})`
          );
        }
      }

      const contractInjection = contract ? buildContractInjection(contract) : '';

      const lastUserText = [...contextMessages].reverse().find(m => m.role === 'user')?.content ?? '';
      let rulesAppend = '';
      try {
        const { appendRulesForUserMessage } = await import('../rules/runtime-inject.js');
        rulesAppend = appendRulesForUserMessage(typeof lastUserText === 'string' ? lastUserText : JSON.stringify(lastUserText));
      } catch {
        /* rules 模块不可用时跳过 */
      }

      let skillRulesAppend = '';
      try {
        const { getActiveSkillRulesPrompt } = await import('../rules/active-skills.js');
        skillRulesAppend = getActiveSkillRulesPrompt();
      } catch {
        /* active skills 不可用时跳过 */
      }

      const systemContent = [
        basePrompt,
        rulesAppend,
        skillRulesAppend,
        contractInjection,
        sessionMemoryPrefix ? `[记忆上下文]\n${sessionMemoryPrefix}` : '',
        isOngoing ? '[对话已在进行中，无需重新自我介绍。直接回应用户最新消息。]' : '',
      ].filter(Boolean).join('\n\n');

      const messages: IChatMessage[] = [
        { role: 'system', content: systemContent },
        ...contextMessages,
      ];

      const toolCallReminder = round === 0 && !isOngoing && tools.list().length > 0
        ? '\n\n[INSTRUCTION] When the user gives a clear task, call relevant tools (skill_search, memory_search) before generating text. However, if the user\'s request is vague or missing critical details (format, scope, requirements), reply with clarifying questions FIRST instead of blindly executing.'
        : undefined;

      onProgress?.({ type: 'thinking', round, model: lastModel || undefined, message_count: messages.length });
      console.error(`[Agent] runLoop round ${round}: calling LLM (msgCount=${messages.length})`);
      const llmStartMs = Date.now();

      // 模型选择（面板）：首轮用思考模型，工具执行轮用工具模型；未设置则交给路由器自动选型。
      const roundCapability = (round === 0 && runtime?.thinkingCapability)
        ? runtime.thinkingCapability
        : runtime?.toolCapability;
      const chatOpts = {
        tools: tools.list(),
        toolChoice: 'auto' as const,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        append_system_prompt: toolCallReminder,
        capability: roundCapability,
      };

      const canStream = !!onProgress && typeof llm.chatStream === 'function';
      const onDelta = (delta: ILLMStreamDelta) => {
        if (delta.reasoning) onProgress!({ type: 'reasoning', round, delta: delta.reasoning });
        if (delta.content) onProgress!({ type: 'content', round, delta: delta.content });
      };

      // RetryLoop 模式：开启后对限流/瞬时错误做更宽的有界退避重试；
      // 关闭时保持旧行为（仅连接类错误重试一次）。
      const backoffs = runtime?.retryLoop ? [2000, 5000, 10000] : [5000];
      const retriableRe = runtime?.retryLoop
        ? /fetch failed|ECONNREFUSED|ECONNRESET|timeout|429|50[023]|exhausted|reset/i
        : /fetch failed|ECONNREFUSED|ECONNRESET/;

      let response!: Awaited<ReturnType<typeof llm.chat>>;
      {
        let lastErr: unknown;
        let ok = false;
        for (let attempt = 0; attempt <= backoffs.length; attempt++) {
          try {
            response = canStream
              ? await llm.chatStream!(messages, chatOpts, onDelta)
              : await llm.chat(messages, chatOpts);
            ok = true;
            break;
          } catch (llmErr) {
            lastErr = llmErr;
            const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
            if (attempt >= backoffs.length || !retriableRe.test(errMsg)) throw llmErr;
            console.error(`[Agent] runLoop round ${round}: LLM error, retry ${attempt + 1}/${backoffs.length} in ${backoffs[attempt]}ms: ${errMsg}`);
            await new Promise(r => setTimeout(r, backoffs[attempt]!));
          }
        }
        if (!ok) throw lastErr ?? new Error('LLM call failed');
      }
      console.error(`[Agent] runLoop round ${round}: LLM responded in ${Date.now()-llmStartMs}ms, toolCalls=${response.toolCalls.length}, contentLen=${response.content?.length ?? 0}, model=${response.model}`);

      lastModel = response.model || lastModel;
      if (response.usage) {
        if (!totalUsage) {
          totalUsage = { ...response.usage };
        } else {
          totalUsage.promptTokens += response.usage.promptTokens;
          totalUsage.completionTokens += response.usage.completionTokens;
          totalUsage.totalTokens += response.usage.totalTokens;
        }
      }

      // 追加 assistant 消息
      conversations.append(convId, {
        role: 'assistant',
        content: response.content ?? '',
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      });

      if (response.toolCalls.length === 0) {
        const cleaned = (response.content ?? '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();

        // 空收尾守卫：模型既没调用工具、又没产出内容（常见于某次工具调用失败后
        // 直接放弃）。不要把"（暂无文本回复）"当最终结果——注入一次恢复提示，
        // 逼它用已有信息把活干完，再继续一轮。最多兜底一次，避免死循环。
        if (!cleaned && emptyNudges < 1) {
          emptyNudges++;
          conversations.append(convId, {
            role: 'system',
            content: '[SYSTEM] 你上一轮没有产出任何内容。请立刻基于已获取的信息直接给出最终结果/报告；'
              + '若某个工具不可用或调用失败，就改用其它可用工具或你已掌握的信息尽力完成，'
              + '不要返回空白，也不要只复述计划。',
          });
          console.error('[Agent] empty final response — injected recovery nudge, retrying');
          continue;
        }

        const text = cleaned || '（暂无文本回复）';

        // 模型不再调用工具并给出文本答复 → 视为最终结果。
        // 不再基于"本轮无工具调用"这一文本启发式去逐步推进 contract、注入
        // "[DONE] 某步骤" 检查点——那会误导模型以为任务已完成而提前空转
        // （实测：激活 digist/ecosystem 技能后没真正调用其工具、最终空回复）。
        // ReAct 循环让模型自行决定何时调用工具、何时收尾；contract 只保留
        // 约束 + 计划注入做持续引导（见 buildContractInjection）。
        if (contract && !contract.completed) {
          contract.completed = true;
          if (sessionMemory) {
            sessionMemory.saveContract(convId, serializeContract(contract));
          }
        }

        onProgress?.({ type: 'done', content: text, model: lastModel });
        return { text, usage: totalUsage, model: lastModel };
      }

      // ── Malformed tool_call arguments: sanitize before forwarding ──
      // LLMs occasionally emit invalid JSON in tool_call arguments (e.g. `{}""`,
      // trailing commas). Sanitize them to `{}` so downstream roundtrips don't
      // trigger upstream 500s. Log for diagnostics.
      for (const tc of response.toolCalls) {
        try {
          JSON.parse(tc.function.arguments);
        } catch {
          console.warn(`[Agent] Sanitizing malformed tool_call args for ${tc.function.name}: ${tc.function.arguments?.slice(0, 200)}`);
          tc.function.arguments = '{}';
        }
      }

      const toolTasks = response.toolCalls.map(async (tc) => {
        const args: Record<string, unknown> = JSON.parse(tc.function.arguments);

        const callTimestamp = new Date().toISOString();
        onProgress?.({ type: 'tool_call', tool: tc.function.name, args, call_id: tc.id, timestamp: callTimestamp });

        const toolStartMs = Date.now();
        let result: unknown;
        let toolSuccess = true;
        try {
          result = await tools.execute(tc.function.name, args);
        } catch (err) {
          toolSuccess = false;
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        const toolDurationMs = Date.now() - toolStartMs;

        let payload: string;
        try {
          payload = JSON.stringify(result);
        } catch {
          payload = String(result);
        }
        if (payload.length > maxToolOutputLen) {
          payload = `${payload.slice(0, maxToolOutputLen)}…(已截断)`;
        }

        onProgress?.({ type: 'tool_result', tool: tc.function.name, result: payload.slice(0, 200), call_id: tc.id, success: toolSuccess, duration_ms: toolDurationMs });

        return { id: tc.id, payload };
      });

      const toolResults = await Promise.allSettled(toolTasks);

      // 按原始 toolCalls 顺序追加结果，保证 LLM 消息交替正确
      for (let i = 0; i < response.toolCalls.length; i++) {
        const settled = toolResults[i]!;
        const toolCallId = response.toolCalls[i]!.id;
        const payload = settled.status === 'fulfilled'
          ? settled.value.payload
          : JSON.stringify({ error: String((settled as PromiseRejectedResult).reason) });

        conversations.append(convId, {
          role: 'tool',
          content: payload,
          toolCallId,
        });

        // Track futile tool calls: empty results or errors
        const toolName = response.toolCalls[i]!.function.name;
        const isEmpty = payload === '{"results":[],"total":0}'
          || payload === '{"skills":[],"total":0,"draft":0,"verified":0}'
          || payload.startsWith('{"ok":false,"error":');
        if (isEmpty) {
          futileCallCounts.set(toolName, (futileCallCounts.get(toolName) ?? 0) + 1);
        }
      }

      // Inject a guard when repeated futile calls detected
      const overLimitTools = [...futileCallCounts.entries()]
        .filter(([, count]) => count >= FUTILE_CALL_LIMIT)
        .map(([name]) => name);
      if (overLimitTools.length > 0) {
        const guard = `[SYSTEM] The following tools returned empty/error results ${FUTILE_CALL_LIMIT}+ times: ${overLimitTools.join(', ')}. ` +
          `Stop calling them with similar queries. Instead, answer based on your existing knowledge or tell the user what tools are actually available.`;
        conversations.append(convId, { role: 'system', content: guard });
        console.warn(`[Agent] Futile call guard triggered for: ${overLimitTools.join(', ')}`);
      }
    }

    return { text: '已达到工具调用轮数上限，请简化任务或分步提问。', usage: totalUsage, model: lastModel };
  }

  const USAGE_LOG_DIR = join(homedir(), '.polarcop', 'logs');
  const USAGE_LOG_PATH = join(USAGE_LOG_DIR, 'llm-usage.jsonl');
  const USAGE_RETENTION_DAYS = 30;
  let usageLogDirCreated = false;

  const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
    'qwen3.6-plus':     { prompt: 0.80,  completion: 2.00 },
    'qwen3-coder-plus': { prompt: 1.00,  completion: 3.00 },
    'qwen-plus':        { prompt: 0.80,  completion: 2.00 },
    'qwen-turbo':       { prompt: 0.30,  completion: 0.60 },
    'gpt-4o':           { prompt: 2.50,  completion: 10.00 },
    'gpt-4o-mini':      { prompt: 0.15,  completion: 0.60 },
    'claude-sonnet-4':  { prompt: 3.00,  completion: 15.00 },
    'claude-haiku':     { prompt: 0.80,  completion: 4.00 },
    'deepseek-chat':    { prompt: 0.14,  completion: 0.28 },
    'deepseek-reasoner':{ prompt: 0.55,  completion: 2.19 },
  };

  function estimateCost(model: string, usage: NonNullable<ILLMResponse['usage']>): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    return (usage.promptTokens * pricing.prompt + usage.completionTokens * pricing.completion) / 1_000_000;
  }

  function rotateUsageLogs() {
    try {
      const { readdirSync, unlinkSync, statSync } = require('node:fs') as typeof import('node:fs');
      const cutoff = Date.now() - USAGE_RETENTION_DAYS * 86400000;
      for (const f of readdirSync(USAGE_LOG_DIR)) {
        if (!f.startsWith('llm-usage') || !f.endsWith('.jsonl')) continue;
        const fp = join(USAGE_LOG_DIR, f);
        if (statSync(fp).mtimeMs < cutoff) unlinkSync(fp);
      }
    } catch { /* non-critical */ }
  }

  function persistUsage(
    userId: string, channel: string,
    usage: NonNullable<ILLMResponse['usage']>,
    model?: string, task?: string,
  ) {
    try {
      if (!usageLogDirCreated) {
        mkdirSync(dirname(USAGE_LOG_PATH), { recursive: true });
        usageLogDirCreated = true;
        rotateUsageLogs();
      }
      const m = model || 'unknown';
      const entry = {
        timestamp: new Date().toISOString(),
        user_id: userId,
        model: m,
        prompt_tokens: usage.promptTokens,
        completion_tokens: usage.completionTokens,
        estimated_cost_usd: Math.round(estimateCost(m, usage) * 1e6) / 1e6,
        task: task || channel,
      };
      appendFileSync(USAGE_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch {
      // non-fatal: don't break agent flow if logging fails
    }
  }

  return {
    handleMessage,
    /** 获取 Agent 状态 */
    getStatus() {
      return {
        toolCount: tools.list().length,
      };
    },
  };
}
