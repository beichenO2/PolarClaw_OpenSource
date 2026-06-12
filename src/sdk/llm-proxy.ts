/**
 * LLM Proxy SDK — Capability-Level Based Model Selection
 *
 * 设计原则：调用方只描述需求档次（capability code），不选模型。
 * 模型选择权完全归 LLM Proxy（PolarPrivate），调用方无权也无需知道
 * 背后使用的具体模型名、供应商或 Base URL。
 *
 * 4-bit capability code: QCSA (Quality, Context, Speed, Agentic)
 *   - Q (质量): 0 = 普通, 1 = 旗舰
 *   - C (上下文): 0 = 标准 (~200K), 1 = 长上下文 (~1M)
 *   - S (速度): 0 = 普通, 1 = 高速
 *   - A (Agent): 0 = 对话, 1 = Agent/tool-use
 *
 * Vision: V + 4-bit QCSA (e.g. V0000, V1000)
 * Local: L0000 = embedding, L0001 = chat (qwen3:8b)
 *
 * 调用方式:
 *   import { createLLMClient } from './llm-proxy.js';
 *   const llm = createLLMClient();
 *   const result = await llm.chat(messages, { capability: '0001' });
 */

function getLLMProxyBase(): string {
  return process.env.POLARPRIVATE_URL?.trim() || 'http://127.0.0.1:12790';
}
const LLM_PROXY_V1_SUFFIX = '/v1';

export type CapabilityCode = string; // 4-char binary like '0000', '0001', '1000'

/**
 * Normalize a capability code to 4-char 0/1 string (QCSA).
 * Accepts legacy 3-char codes by appending '0' (backward compat).
 */
export function normalizeCode(code?: string): CapabilityCode {
  const raw = (code ?? '0000').replace(/[^01]/g, '0');
  if (raw.length === 3) return raw + '0';
  return raw.padEnd(4, '0').slice(0, 4);
}

/** Cloud: send 4-bit QCSA. PolarPrivate maps to upstream — never vendor names here. */
export function cloudCapabilityToModelId(code: CapabilityCode): string {
  return normalizeCode(code);
}

/** Local: L0000 = embedding, L0001 = chat. Prefix L + 4-bit code. */
export function localCapabilityToModelId(code: CapabilityCode): string {
  return `L${normalizeCode(code)}`;
}

function resolveModelInternal(code: CapabilityCode, tier: 'cloud' | 'local'): string {
  if (tier === 'local') return localCapabilityToModelId(code);
  const upper = code.toUpperCase();
  if (upper.startsWith('V')) return upper;
  return cloudCapabilityToModelId(code);
}

/** Map intent → 4-bit QCSA cloud code. */
export function intentToCode(intent: string, _tier: 'cloud' | 'local' = 'cloud'): CapabilityCode {
  switch (intent) {
    case 'coding': return '0001';   // Agent/tool-use (DS V4 Flash)
    case 'research': return '0100'; // 长上下文 (DS V4 Pro 1M)
    case 'vision': return 'V0000';  // 默认视觉 (qwen3.7-plus)
    case 'general':
    default: return '0000';         // 均衡对话 (GLM-5.1)
  }
}

export interface LLMProxyRequestOptions {
  capability?: CapabilityCode;
  /** cloud = PolarPrivate upstream; local = Ollama via L-prefix codes */
  tier?: 'cloud' | 'local';
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
  toolChoice?: 'auto' | 'none' | 'required';
  append_system_prompt?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LLMProxyResponse {
  content: string | null;
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  latencyMs: number;
}

export interface LLMStreamDelta {
  reasoning?: string;
  content?: string;
}

export interface LLMProxyClient {
  chat(messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>, options?: LLMProxyRequestOptions): Promise<LLMProxyResponse>;
  /** Streaming chat — emits reasoning/content deltas, resolves with the aggregated response. */
  chatStream(
    messages: Array<{ role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string }>,
    options: LLMProxyRequestOptions | undefined,
    onDelta: (delta: LLMStreamDelta) => void,
  ): Promise<LLMProxyResponse>;
  healthCheck(): Promise<{ status: string; vault_unlocked: boolean }>;
}

/** Accumulates streamed OpenAI-style tool_call deltas keyed by index. */
interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Create a client that talks to LLM Proxy (PolarPrivate).
 * The client sends capability codes — the proxy decides which model to use.
 *
 * No Base URL config, no model names, no API keys needed by the caller.
 */
export function createLLMClient(): LLMProxyClient {
  return {
    async chat(messages, options = {}) {
      const startMs = Date.now();
      const capability = normalizeCode(options.capability);
      const timeoutMs = options.timeoutMs ?? 300_000;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      const tier = options.tier ?? 'cloud';
      const model = resolveModelInternal(capability, tier);
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
      };
      if (options.append_system_prompt) {
        body.append_system_prompt = options.append_system_prompt;
      }
      if (options.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice ?? 'auto';
      }

      try {
        const res = await fetch(`${getLLMProxyBase()}${LLM_PROXY_V1_SUFFIX}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Identify the caller so PolarPrivate's FairScheduler applies the
            // intended priority (interactive chat ranks above batch jobs).
            'x-client-id': process.env.POLARPRIVATE_CLIENT_ID?.trim() || 'polarclaw',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          const msgSummary = (messages as Array<{role: string; content?: string; tool_calls?: unknown[]}>)
            .map((m, i) => `  [${i}] role=${m.role} content=${(m.content ?? '').slice(0, 60)} tool_calls=${m.tool_calls ? JSON.stringify(m.tool_calls).slice(0, 120) : 'none'}`)
            .join('\n');
          console.error(`[LLMProxy] ${res.status} error. model=${model} tier=${tier} msgCount=${(messages as unknown[]).length}\n${msgSummary}`);
          throw new Error(`LLM Proxy error ${res.status}: ${errText.slice(0, 500)}`);
        }

        const data = await res.json() as {
          choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
          model?: string;
        };

        const choice = data.choices?.[0]?.message;
        return {
          content: choice?.content ?? null,
          toolCalls: choice?.tool_calls ?? [],
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          } : undefined,
          model: data.model ?? model,
          latencyMs: Date.now() - startMs,
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async chatStream(messages, options = {}, onDelta) {
      const startMs = Date.now();
      const capability = normalizeCode(options.capability);
      const timeoutMs = options.timeoutMs ?? 300_000;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort());
      }

      const tier = options.tier ?? 'cloud';
      const model = resolveModelInternal(capability, tier);
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      };
      if (options.append_system_prompt) {
        body.append_system_prompt = options.append_system_prompt;
      }
      if (options.tools?.length) {
        body.tools = options.tools;
        body.tool_choice = options.toolChoice ?? 'auto';
      }

      try {
        const res = await fetch(`${getLLMProxyBase()}${LLM_PROXY_V1_SUFFIX}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'x-client-id': process.env.POLARPRIVATE_CLIENT_ID?.trim() || 'polarclaw',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => '');
          throw new Error(`LLM Proxy stream error ${res.status}: ${errText.slice(0, 500)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let contentText = '';
        const toolAcc = new Map<number, ToolCallAccumulator>();
        let usage: LLMProxyResponse['usage'];
        let upstreamModel = model;

        const handleEvent = (jsonStr: string): void => {
          if (jsonStr === '[DONE]') return;
          let evt: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
            model?: string;
          };
          try {
            evt = JSON.parse(jsonStr);
          } catch {
            return;
          }
          if (evt.model) upstreamModel = evt.model;
          if (evt.usage) {
            usage = {
              promptTokens: evt.usage.prompt_tokens,
              completionTokens: evt.usage.completion_tokens,
              totalTokens: evt.usage.total_tokens,
            };
          }
          const delta = evt.choices?.[0]?.delta;
          if (!delta) return;
          if (delta.reasoning_content) {
            onDelta({ reasoning: delta.reasoning_content });
          }
          if (delta.content) {
            contentText += delta.content;
            onDelta({ content: delta.content });
          }
          if (delta.tool_calls?.length) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              const acc = toolAcc.get(idx) ?? { id: '', name: '', arguments: '' };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
              toolAcc.set(idx, acc);
            }
          }
        };

        // SSE frames are separated by blank lines; each frame may have one data: line.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nlIdx: number;
          while ((nlIdx = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nlIdx).trim();
            buffer = buffer.slice(nlIdx + 1);
            if (line.startsWith('data:')) {
              handleEvent(line.slice(5).trim());
            }
          }
        }
        if (buffer.trim().startsWith('data:')) {
          handleEvent(buffer.trim().slice(5).trim());
        }

        const toolCalls = [...toolAcc.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, acc], i) => ({
            id: acc.id || `call_${i}`,
            function: { name: acc.name, arguments: acc.arguments || '{}' },
          }))
          .filter(tc => tc.function.name);

        return {
          content: contentText || null,
          toolCalls,
          usage,
          model: upstreamModel,
          latencyMs: Date.now() - startMs,
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async healthCheck() {
      const res = await fetch(`${getLLMProxyBase()}/health`, { method: 'GET' });
      return res.json() as Promise<{ status: string; vault_unlocked: boolean }>;
    },
  };
}
