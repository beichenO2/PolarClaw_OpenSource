/**
 * LLM 路由器适配器
 *
 * 通过 LLM Proxy SDK 与 PolarPrivate 通信。
 * 调用方只传 capability code（QCSA 4-bit），不传模型名。
 * 模型选择权完全在 LLM Proxy 侧。
 *
 * 保留意图检测：自动将 intent 映射为 capability code，
 * 也支持调用方直接指定 capability code。
 */

import type { ILLMRouter, ILLMResponse, ILLMOptions, IntentType } from '../../ports/llm.js';
import type { IChatMessage, IToolCall } from '../../ports/memory.js';
import { createLLMClient, intentToCode, normalizeCode, type LLMProxyClient } from '../../sdk/llm-proxy.js';

/** 意图检测正则 */
const INTENT_HINTS: Array<{ pattern: RegExp; intent: IntentType }> = [
  { pattern: /(?:代码|编程|bug|debug|重构|实现|函数|类|接口|API|写一个|修改|编译|运行)/i, intent: 'coding' },
  { pattern: /(?:研究|论文|分析|综述|调研|对比|评估|arXiv|paper)/i, intent: 'research' },
  { pattern: /(?:图片|截图|看看|识别|图中|照片|视觉|image|photo)/i, intent: 'vision' },
];

function detectIntent(messages: IChatMessage[]): IntentType {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return 'general';
  for (const { pattern, intent } of INTENT_HINTS) {
    if (pattern.test(lastUser.content)) return intent;
  }
  return 'general';
}

export interface ILLMConfig {
  /** @deprecated — ignored, SDK hardcodes LLM Proxy address */
  baseUrl?: string;
  /** @deprecated — ignored, LLM Proxy manages keys */
  apiKey?: string;
  /** @deprecated — ignored, model selection is proxy-side */
  models?: Record<IntentType, string>;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  /** @deprecated — single gateway, no fallback needed */
  fallbackProviders?: unknown[];
  requestTimeoutMs?: number;
  concurrencyLimit?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerCooldownMs?: number;
}

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => { this.active++; resolve(); });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const RESILIENCE_RETRY_DELAYS = [1000, 3000]; // per-tier exponential backoff ms

const CLOUD_CASCADE: Record<string, string[]> = {
  '0000': ['0000', '0100', '0110', '0010', '1100'],    // GLM→DS Pro→M3→DS Flash→Qwen
  '0001': ['0001', '0011', '1001', '0010', '1100'],    // Agent Flash→alt→Agent Pro→Flash→Qwen
  '0010': ['0010', '0110', '0000', '1100'],             // DS Flash→M3→GLM→Qwen
  '0100': ['0100', '0110', '0000', '1100'],             // DS Pro→M3→GLM→Qwen
  '0110': ['0110', '0100', '0010', '0000', '1100'],    // M3→DS Pro→DS Flash→GLM→Qwen
  '1000': ['1000', '0100', '0110', '0010', '1100'],    // GLM旗舰→DS Pro→M3→DS Flash→Qwen
  '1100': ['1100', '0000', '0100', '0110', '0010'],    // Qwen→GLM→DS Pro→M3→DS Flash
};

export function createLLMRouter(config: ILLMConfig): ILLMRouter {
  const defaultTemp = config.defaultTemperature ?? 0.7;
  const defaultMaxTokens = config.defaultMaxTokens ?? 4096;
  const requestTimeoutMs = config.requestTimeoutMs ?? 300_000;
  const concurrencyLimit = config.concurrencyLimit ?? 5;
  const semaphore = new Semaphore(concurrencyLimit);

  const client: LLMProxyClient = createLLMClient();

  /**
   * Compute the final QCSA capability code.
   * Force the Agent bit (A=1) only when the code is *auto-selected* from intent;
   * an explicit user-chosen capability (from the Chat panel) is respected as-is
   * so reasoning codes like 1110 don't become the unmapped 1111.
   */
  function resolveCapability(messages: IChatMessage[], options: ILLMOptions): string {
    const explicit = !!options.capability;
    const capability = options.capability ?? intentToCode(detectIntent(messages));
    let finalCapability = normalizeCode(capability);
    if (!explicit && options.tools?.length && !finalCapability.startsWith('V')) {
      const bits = finalCapability.split('');
      bits[3] = '1';
      finalCapability = bits.join('');
    }
    return finalCapability;
  }

  const router: ILLMRouter = {
    resolveModel(messages) {
      const intent = detectIntent(messages);
      const code = intentToCode(intent);
      return { model: `capability:${code}`, intent };
    },

    async chatStream(messages, options = {}, onDelta) {
      const finalCapability = resolveCapability(messages, options);
      const formattedMessages = messages.map(m => {
        const msg: Record<string, unknown> = { role: m.role, content: m.content };
        if (m.toolCalls?.length) {
          msg.tool_calls = m.toolCalls.map(tc => {
            const sanitized = { ...tc, function: { ...tc.function } };
            try { JSON.parse(sanitized.function.arguments); } catch {
              sanitized.function.arguments = '{}';
            }
            return sanitized;
          });
        }
        if (m.toolCallId) msg.tool_call_id = m.toolCallId;
        return msg as { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string };
      });

      try {
        const result = await client.chatStream(formattedMessages, {
          capability: finalCapability,
          temperature: options.temperature ?? defaultTemp,
          maxTokens: options.maxTokens ?? defaultMaxTokens,
          tools: options.tools,
          toolChoice: options.toolChoice,
          append_system_prompt: options.append_system_prompt,
          timeoutMs: requestTimeoutMs,
        }, onDelta);
        return {
          content: result.content,
          toolCalls: result.toolCalls.map(tc => ({
            id: tc.id,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
          usage: result.usage,
          model: result.model,
          latencyMs: result.latencyMs,
        };
      } catch (err) {
        // Streaming failed — fall back to the resilient non-streaming path
        // (full cloud cascade), surfacing the final answer as a single delta.
        console.warn(`[LLMRouter] chatStream failed, falling back to non-stream chat: ${err instanceof Error ? err.message : String(err)}`);
        const r = await router.chat(messages, options);
        if (r.content) onDelta({ content: r.content });
        return r;
      }
    },

    async chat(messages, options = {}) {
      await semaphore.acquire();
      try {
        const intent = detectIntent(messages);
        const capability = options.capability
          ?? intentToCode(intent);

        const formattedMessages = messages.map(m => {
          const msg: Record<string, unknown> = { role: m.role, content: m.content };
          if (m.toolCalls?.length) {
            msg.tool_calls = m.toolCalls.map(tc => {
              const sanitized = { ...tc, function: { ...tc.function } };
              try { JSON.parse(sanitized.function.arguments); } catch {
                sanitized.function.arguments = '{}';
              }
              return sanitized;
            });
          }
          if (m.toolCallId) msg.tool_call_id = m.toolCallId;
          return msg as { role: string; content: string; tool_calls?: unknown[]; tool_call_id?: string };
        });

        let finalCapability = normalizeCode(capability);
        // Force A=1 only on auto-selected codes; respect explicit user capability as-is.
        if (!options.capability && options.tools?.length && !finalCapability.startsWith('V')) {
          const bits = finalCapability.split('');
          bits[3] = '1';
          finalCapability = bits.join('');
        }

        const chatOptions = {
          capability: finalCapability,
          temperature: options.temperature ?? defaultTemp,
          maxTokens: options.maxTokens ?? defaultMaxTokens,
          tools: options.tools,
          toolChoice: options.toolChoice,
          append_system_prompt: options.append_system_prompt,
          timeoutMs: requestTimeoutMs,
        };

        // === Cloud Cascade: try multiple QCSA codes, each with retries ===
        let lastError: Error | null = null;
        const cascade = CLOUD_CASCADE[finalCapability] ?? [finalCapability];
        const triedCodes: string[] = [];

        for (const code of cascade) {
          triedCodes.push(code);
          const tierOptions = { ...chatOptions, capability: code };

          for (let attempt = 0; attempt <= RESILIENCE_RETRY_DELAYS.length; attempt++) {
            try {
              const result = await client.chat(formattedMessages, tierOptions);
              const toolCalls: IToolCall[] = result.toolCalls.map(tc => ({
                id: tc.id,
                function: { name: tc.function.name, arguments: tc.function.arguments },
              }));
              if (code !== finalCapability) {
                console.info(`[LLMRouter] Cascade fallback ${code} (${result.model}) succeeded after ${finalCapability} failed`);
              }
              return {
                content: result.content,
                toolCalls,
                usage: result.usage,
                model: result.model,
                latencyMs: result.latencyMs,
              };
            } catch (err) {
              lastError = err instanceof Error ? err : new Error(String(err));
              const isRetriable = /timeout|ECONNREFUSED|ENOTFOUND|50[03]|429|reset/i.test(lastError.message);
              if (!isRetriable || attempt >= RESILIENCE_RETRY_DELAYS.length) break;
              const delay = RESILIENCE_RETRY_DELAYS[attempt]!;
              console.warn(`[LLMRouter] Code ${code} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
            }
          }
          console.warn(`[LLMRouter] Code ${code} exhausted: ${lastError?.message}. Trying next...`);
        }

        throw new Error(
          `[LLMRouter] All cloud tiers exhausted. Last error: ${lastError?.message ?? 'unknown'}. ` +
          `Tried codes: ${triedCodes.join(' → ')}`,
        );
      } finally {
        semaphore.release();
      }
    },
  };

  return router;
}
