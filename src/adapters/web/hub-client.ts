/**
 * PolarClaw Hub Web Client
 *
 * 用于注册到 Hub Web 并进行用户交互。
 */

// Node.js EventSource polyfill
import { EventSource } from 'eventsource';

export interface HubClientConfig {
  hubUrl: string;
  agentType: 'polarclaw';
  mainModel: 'glm-5.1' | 'qwen-3.6-plus';
  subagentModel: 'glm-5.1' | 'qwen-3.6-plus' | 'minimax-2.7-highspeed';
}

export interface AgentInfo {
  agent_id: string;
  hub_port: number;
}

export interface HubClientStatus {
  agentId: string | null;
  sseConnected: boolean;
  lastHeartbeatAt: string | null;
  lastPromptAt: string | null;
  lastError: string | null;
}

export class HubPromptTimeoutError extends Error {
  code = 'timeout';
  constructor(message: string) {
    super(message);
    this.name = 'HubPromptTimeoutError';
  }
}

export class HubPromptInvalidError extends Error {
  code = 'invalid';
  constructor(message: string) {
    super(message);
    this.name = 'HubPromptInvalidError';
  }
}

export class HubNetworkError extends Error {
  code = 'network';
  constructor(message: string) {
    super(message);
    this.name = 'HubNetworkError';
  }
}

export class HubClient {
  private hubUrl: string;
  private agentId: string | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private aliveConnection: EventSource | null = null;

  private sseConnected = false;
  private lastHeartbeatAt: number | null = null;
  private lastPromptAt: number | null = null;
  private lastError: string | null = null;

  // SSE reconnection state
  private sseBackoffMs = 1000;
  private sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sseFirstFailedAt: number | null = null;
  private sseHttpFallbackStarted = false;

  constructor(hubUrl: string) {
    this.hubUrl = hubUrl;
  }

  async register(config: HubClientConfig): Promise<AgentInfo> {
    const resp = await fetch(`${this.hubUrl}/api/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_type: config.agentType,
        agent_name: 'PolarClaw',
        main_model: config.mainModel,
        subagent_model: config.subagentModel,
        capabilities: ['chat', 'yolo', 'tools', 'memory'],
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Hub registration failed: ${resp.status} ${text}`);
    }

    const data = (await resp.json()) as AgentInfo;
    this.agentId = data.agent_id;

    // 启动 SSE 长连接（优先）
    this.startAliveConnection();

    console.error(`[HubClient] Registered as ${this.agentId}`);
    return data;
  }

  // SSE 长连接心跳，指数退避重连
  private startAliveConnection() {
    if (!this.agentId) return;
    this.connectSSE();
  }

  private connectSSE() {
    if (!this.agentId) return;

    this.aliveConnection = new EventSource(`${this.hubUrl}/api/agents/${this.agentId}/alive`);

    this.aliveConnection.onopen = () => {
      console.error('[HubClient] SSE alive connection established');
      this.sseConnected = true;
      this.sseBackoffMs = 1000;
      this.sseFirstFailedAt = null;
      this.sseHttpFallbackStarted = false;
    };

    this.aliveConnection.onerror = (_err) => {
      this.sseConnected = false;
      const now = Date.now();

      if (this.sseFirstFailedAt === null) {
        this.sseFirstFailedAt = now;
      }

      const elapsedSinceFirstFail = now - this.sseFirstFailedAt;

      // 关闭当前 EventSource
      this.aliveConnection?.close();
      this.aliveConnection = null;

      console.error(`[HubClient] SSE error, reconnecting in ${this.sseBackoffMs}ms (elapsed: ${elapsedSinceFirstFail}ms)`);

      // 仅当连续失败 ≥ 60 s 才启动 HTTP 心跳兜底
      if (elapsedSinceFirstFail >= 60000 && !this.sseHttpFallbackStarted) {
        this.sseHttpFallbackStarted = true;
        console.error('[HubClient] SSE failed for ≥60s, starting HTTP heartbeat fallback');
        this.startHeartbeat();
      }

      // 指数退避重连，上限 30s
      const delay = this.sseBackoffMs;
      this.sseBackoffMs = Math.min(this.sseBackoffMs * 2, 30000);
      this.sseReconnectTimer = setTimeout(() => {
        this.connectSSE();
      }, delay);
    };

    this.aliveConnection.addEventListener('heartbeat', (_e) => {
      this.lastHeartbeatAt = Date.now();
    });
  }

  // HTTP 心跳（SSE 持续失败 ≥ 60s 后的兜底方案）
  private startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.heartbeatInterval = setInterval(async () => {
      if (!this.agentId) return;
      try {
        await fetch(`${this.hubUrl}/api/agents/${this.agentId}/heartbeat`, {
          method: 'POST',
        });
        this.lastHeartbeatAt = Date.now();
      } catch (err) {
        console.error('[HubClient] Heartbeat failed:', err);
      }
    }, 30000);
  }

  async sendPrompt(
    prompt: string,
    options: string[],
    opts?: { timeoutMs?: number; pollIntervalMs?: number },
  ): Promise<string> {
    if (!this.agentId) {
      throw new Error('Not registered with Hub');
    }

    const timeoutMs = opts?.timeoutMs ?? 30 * 60 * 1000;
    const pollIntervalMs = opts?.pollIntervalMs ?? 2000;

    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }

    try {
      // 发送 prompt
      const resp = await fetch(`${this.hubUrl}/api/ui/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: this.agentId,
          prompt,
          options,
        }),
        signal: controller.signal,
      });

      if (resp.status >= 400 && resp.status < 500) {
        const text = await resp.text();
        throw new HubPromptInvalidError(`Send prompt failed: ${resp.status} ${text}`);
      }
      if (resp.status >= 500) {
        const text = await resp.text();
        throw new HubNetworkError(`Send prompt server error: ${resp.status} ${text}`);
      }
      if (!resp.ok) {
        const text = await resp.text();
        throw new HubNetworkError(`Send prompt failed: ${resp.status} ${text}`);
      }

      const { id } = (await resp.json()) as { id: string };

      // 轮询等待回答
      let networkRetries = 0;
      const maxNetworkRetries = 5;
      let retryBackoff = 1000;

      while (true) {
        if (controller.signal.aborted) {
          throw new HubPromptTimeoutError(`sendPrompt timed out after ${timeoutMs}ms`);
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));

        if (controller.signal.aborted) {
          throw new HubPromptTimeoutError(`sendPrompt timed out after ${timeoutMs}ms`);
        }

        this.lastPromptAt = Date.now();

        let pollResp: Response;
        try {
          pollResp = await fetch(`${this.hubUrl}/api/ui/prompts/${id}`, {
            headers: { 'X-Agent-Id': this.agentId! },
            signal: controller.signal,
          });
        } catch (err: unknown) {
          if (controller.signal.aborted) {
            throw new HubPromptTimeoutError(`sendPrompt timed out after ${timeoutMs}ms`);
          }
          // network error
          networkRetries++;
          this.lastError = String(err);
          if (networkRetries > maxNetworkRetries) {
            throw new HubNetworkError(`Poll failed after ${maxNetworkRetries} retries: ${err}`);
          }
          const delay = retryBackoff;
          retryBackoff = Math.min(retryBackoff * 2, 16000);
          console.error(`[HubClient] Poll network error (retry ${networkRetries}/${maxNetworkRetries}), waiting ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (pollResp.status === 404 || pollResp.status === 410) {
          throw new HubPromptInvalidError(`Prompt not found: ${pollResp.status}`);
        }
        if (pollResp.status >= 400 && pollResp.status < 500) {
          throw new HubPromptInvalidError(`Prompt poll invalid: ${pollResp.status}`);
        }
        if (pollResp.status >= 500) {
          networkRetries++;
          this.lastError = `Server error ${pollResp.status}`;
          if (networkRetries > maxNetworkRetries) {
            throw new HubNetworkError(`Poll server error after ${maxNetworkRetries} retries: ${pollResp.status}`);
          }
          const delay = retryBackoff;
          retryBackoff = Math.min(retryBackoff * 2, 16000);
          console.error(`[HubClient] Poll 5xx (retry ${networkRetries}/${maxNetworkRetries}), waiting ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (!pollResp.ok) {
          continue;
        }

        // 成功响应，重置网络重试计数
        networkRetries = 0;
        retryBackoff = 1000;

        const data = (await pollResp.json()) as {
          answered: boolean;
          answer?: string;
          freeform_text?: string;
        };

        if (data.answered) {
          this.lastError = null;
          const parts = [data.answer].filter(Boolean);
          if (data.freeform_text) {
            parts.push(data.freeform_text);
          }
          return parts.join('\n');
        }
      }
    } catch (err) {
      if (err instanceof HubPromptTimeoutError || err instanceof HubPromptInvalidError || err instanceof HubNetworkError) {
        this.lastError = err.message;
        throw err;
      }
      if ((err as Error)?.name === 'AbortError') {
        const timeoutErr = new HubPromptTimeoutError(`sendPrompt timed out after ${timeoutMs}ms`);
        this.lastError = timeoutErr.message;
        throw timeoutErr;
      }
      this.lastError = String(err);
      throw err;
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async unregister() {
    // 取消 SSE 重连定时器
    if (this.sseReconnectTimer) {
      clearTimeout(this.sseReconnectTimer);
      this.sseReconnectTimer = null;
    }

    // 关闭 SSE 连接
    if (this.aliveConnection) {
      this.aliveConnection.close();
      this.aliveConnection = null;
    }
    this.sseConnected = false;

    // 关闭 HTTP 心跳
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.agentId) {
      try {
        await fetch(`${this.hubUrl}/api/agents/${this.agentId}/unregister`, {
          method: 'POST',
        });
      } catch {
        // ignore
      }
      this.agentId = null;
    }
  }

  getAgentId(): string | null {
    return this.agentId;
  }

  getStatus(): HubClientStatus {
    return {
      agentId: this.agentId,
      sseConnected: this.sseConnected,
      lastHeartbeatAt: this.lastHeartbeatAt !== null ? new Date(this.lastHeartbeatAt).toISOString() : null,
      lastPromptAt: this.lastPromptAt !== null ? new Date(this.lastPromptAt).toISOString() : null,
      lastError: this.lastError,
    };
  }
}
