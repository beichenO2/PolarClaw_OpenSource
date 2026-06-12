/**
 * PolarPrivate API 客户端
 *
 * 与 PolarPrivate（默认端口 12790）通信：
 * - 拉取用户已登记的 Identity 实体
 * - 检查消息中是否包含已知 Secret
 *
 * PolarPrivate Vault 必须处于解锁状态。
 * 如果不可用则降级为纯正则检测（不阻断）。
 *
 * API 格式参考 PolarPrivate 实际端点：
 *   GET  /health                  → { status, vault_unlocked }
 *   GET  /api/identities          → { items: IdentityOut[], total }
 *   GET  /api/secrets             → { items: SecretOut[], total }（不含明文值）
 *   GET  /api/sanitize/mappings   → SDK 映射表（无鉴权）
 * Plaintext-leak detection (260505 batch): reveal endpoint removed; matching
 * is now done against /api/sanitize/mappings (which exposes placeholders only).
 */

import type { IPrivacyEntity } from '../../ports/privacy.js';

export interface IPolarPrivateConfig {
  /** PolarPrivate 后端地址（默认 http://127.0.0.1:12790） */
  baseUrl: string;
  /** 请求超时 ms */
  timeoutMs?: number;
  /** 可选：限定 project_id 过滤 */
  projectId?: string;
}

/** /api/identities → items[] */
interface IdentityOut {
  id: string;
  key: string;
  value: string;
  project_id: string | null;
  category: string | null;
}

/** /api/secrets → items[]（不含 value） */
interface SecretOut {
  id: string;
  key: string;
  enabled: boolean;
  project_id: string | null;
  category: string | null;
}

/** /health 响应 */
interface HealthResponse {
  status: string;
  vault_unlocked: boolean;
}

interface ListResponse<T> {
  items: T[];
  total: number;
}

export function createPolarPrivateClient(config: IPolarPrivateConfig) {
  const { baseUrl, timeoutMs = 3000, projectId } = config;

  async function fetchJson<T>(path: string): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      return null;
    }
  }

  async function postJson<T>(path: string): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      return null;
    }
  }

  return {
    /** 检查 PolarPrivate 是否可用且 Vault 已解锁 */
    async isAvailable(): Promise<boolean> {
      const health = await fetchJson<HealthResponse>('/health');
      return health?.vault_unlocked === true;
    },

    /** 拉取所有 Identity 实体 → 转为 IPrivacyEntity 格式 */
    async loadIdentities(): Promise<IPrivacyEntity[]> {
      const query = projectId
        ? `/api/identities?project_id=${projectId}&limit=200`
        : '/api/identities?limit=200';
      const data = await fetchJson<ListResponse<IdentityOut>>(query);
      if (!data?.items) return [];

      return data.items.map(row => ({
        type: (row.category || 'NAME').toUpperCase(),
        value: row.value,
      }));
    },

    /**
     * 检查文本中是否包含任何已知的 Secret 明文值
     *
     * 实现：遍历所有 Secret → 对每个调用 reveal → 检查文本中是否存在
     * 性能说明：Secret 数量通常 < 50，且有超时保护
     */
    async containsKnownSecret(text: string): Promise<{
      found: boolean;
      matchedSecrets: Array<{ name: string; category: string }>;
    }> {
      const query = projectId
        ? `/api/secrets?project_id=${projectId}&limit=200`
        : '/api/secrets?limit=200';
      const data = await fetchJson<ListResponse<SecretOut>>(query);
      if (!data?.items) return { found: false, matchedSecrets: [] };

      const matched: Array<{ name: string; category: string }> = [];
      for (const s of data.items) {
        if (!s.enabled) continue;
        if (text.includes(`[[secret_ref.${s.key}]]`)) {
          matched.push({ name: s.key, category: s.category || '' });
        }
      }

      return { found: matched.length > 0, matchedSecrets: matched };
    },

    /**
     * Resolve a feishu open_id to a polarisor_user_id via identity_bindings.
     * Returns null if not bound or PolarPrivate unavailable.
     */
    async resolveFeishuUser(openId: string): Promise<{ user_id: string; username: string } | null> {
      const params = new URLSearchParams({ service: 'feishu', external_username: openId });
      const result = await fetchJson<{ user_id: string; username: string }>(
        `/api/identity-bindings/resolve?${params}`
      );
      return result;
    },

    /**
     * Create an identity binding for a feishu user.
     */
    async bindFeishuUser(polarisorUserId: string, openId: string, displayName?: string): Promise<boolean> {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const body: Record<string, string> = {
          user_id: polarisorUserId,
          service: 'feishu',
          external_username: openId,
        };
        if (displayName) body.display_name = displayName;
        const res = await fetch(`${baseUrl}/api/identity-bindings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timer);
        return res.ok || res.status === 409;
      } catch {
        return false;
      }
    },
  };
}
