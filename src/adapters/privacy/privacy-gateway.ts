/**
 * Channel Privacy Gateway — 隐私网关适配器
 *
 * 实现 IPrivacyGateway 接口。
 * 组合 PII 正则检测 + PolarPrivate 已知实体 + Secret 拦截。
 *
 * 架构位置：Channel → [PrivacyGateway] → Agent Loop
 */

import type { IPrivacyGateway, IPrivacyEntity } from '../../ports/privacy.js';
import { sanitizeWithCustomEntities, desanitize, type PiiVault } from './pii-detector.js';
import { createPolarPrivateClient, type IPolarPrivateConfig } from './polar-private-client.js';

export interface IPrivacyGatewayConfig {
  polarPrivate?: IPolarPrivateConfig;
  /** 是否启用 Secret 拦截（默认 true） */
  enableSecretInterception?: boolean;
}

export function createPrivacyGateway(config: IPrivacyGatewayConfig = {}): IPrivacyGateway {
  const ppClient = config.polarPrivate
    ? createPolarPrivateClient(config.polarPrivate)
    : null;

  const enableSecretInterception = config.enableSecretInterception ?? true;

  /** 每个用户的 PII vault */
  const userVaults = new Map<string, PiiVault>();
  /** 每个用户已缓存的 PolarPrivate 实体，key = userId 用于隔离不同用户的实体列表 */
  const entityCache = new Map<string, { entities: IPrivacyEntity[]; cachedAt: number }>();
  // 缓存策略：每用户独立 5 分钟 TTL，过期后下次 sanitize 时懒加载刷新
  const CACHE_TTL_MS = 5 * 60 * 1000;

  function getVault(userId: string): PiiVault {
    let vault = userVaults.get(userId);
    if (!vault) {
      vault = new Map();
      userVaults.set(userId, vault);
    }
    return vault;
  }

  return {
    async sanitize(userId, text) {
      const vault = getVault(userId);

      // 1. 从 PolarPrivate 加载已知实体（带缓存）
      const customEntities = await this.loadEntities(userId);

      // 2. 自定义实体 + 正则 PII 联合脱敏
      const result = sanitizeWithCustomEntities(
        text,
        customEntities.map(e => ({ value: e.value, type: e.type })),
        vault,
      );

      // 3. Secret 拦截检查
      if (enableSecretInterception && ppClient) {
        const secretCheck = await ppClient.containsKnownSecret(text);
        if (secretCheck.found) {
          const names = secretCheck.matchedSecrets.map(s => s.name).join('、');
          return {
            blocked: true,
            sanitized: result.sanitized,
            entities: result.entities.map(e => ({
              type: e.type,
              value: e.original,
              placeholder: e.placeholder,
            })),
            warning: `⚠️ 检测到您的消息包含已登记的敏感信息（${names}）。已自动拦截，请使用脱敏版本发送。`,
          };
        }
      }

      return {
        blocked: false,
        sanitized: result.sanitized,
        entities: result.entities.map(e => ({
          type: e.type,
          value: e.original,
          placeholder: e.placeholder,
        })),
      };
    },

    desanitize(userId, text) {
      const vault = userVaults.get(userId);
      if (!vault || vault.size === 0) return text;
      return desanitize(text, vault);
    },

    async loadEntities(userId) {
      if (!ppClient) return [];

      // 检查缓存
      const cached = entityCache.get(userId);
      if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.entities;
      }

      // Forward-compatible: pass userId if loadIdentities supports it, otherwise call without
      const entities = ppClient.loadIdentities.length > 0
        ? await (ppClient.loadIdentities as (uid?: string) => Promise<IPrivacyEntity[]>)(userId)
        : await ppClient.loadIdentities();
      entityCache.set(userId, { entities, cachedAt: Date.now() });
      return entities;
    },

    clearVault(userId) {
      userVaults.delete(userId);
      entityCache.delete(userId);
    },
  };
}
