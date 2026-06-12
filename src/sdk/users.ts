/**
 * SDK users module — resolves PolarUser identity
 *
 * Wraps the core PolarUserRegistry to provide a sanitized public API
 * that never leaks internal persona paths or memory implementation details.
 */

import type { PolarUserRegistry } from '../core/polar-user.js';
import type { PolarUserInfo, ResolveUserResult } from './types.js';
import { SDKError } from './types.js';

export interface UsersModuleConfig {
  registry: PolarUserRegistry;
}

function sanitizeUser(user: { id: string; kind: string; display_name: string; tool_scopes: string[]; sdk_scopes: string[] }): PolarUserInfo {
  return {
    id: user.id,
    kind: user.kind as PolarUserInfo['kind'],
    display_name: user.display_name,
    tool_scopes: user.tool_scopes,
    sdk_scopes: user.sdk_scopes,
  };
}

export function createUsersModule(config: UsersModuleConfig) {
  const { registry } = config;

  return {
    resolve(userId: string): ResolveUserResult {
      const existing = registry.get(userId);
      const user = registry.resolve(userId);
      return {
        user: sanitizeUser(user),
        source: existing ? 'registry' : 'inferred',
      };
    },

    get(userId: string): PolarUserInfo | null {
      const user = registry.get(userId);
      return user ? sanitizeUser(user) : null;
    },

    listProjects(): PolarUserInfo[] {
      return registry.listProjects().map(sanitizeUser);
    },

    listHumans(): PolarUserInfo[] {
      return registry.listHumans().map(sanitizeUser);
    },

    hasScope(userId: string, scope: string): boolean {
      return registry.hasSdkScope(userId, scope);
    },

    /**
     * Check authorization: does the caller have the required SDK scope?
     * Throws SDKError('permission_denied') if not.
     */
    requireScope(callerId: string, scope: string): void {
      if (!registry.hasSdkScope(callerId, scope)) {
        throw new SDKError('permission_denied', `User ${callerId} lacks SDK scope: ${scope}`, { scope });
      }
    },
  };
}

export type UsersModule = ReturnType<typeof createUsersModule>;
