/**
 * SDK lobsters module — thin adapter querying PolarPilot contract
 *
 * Returns sanitized status summaries (dormant/active/current node)
 * by calling PolarPilot's HTTP API instead of internal stores.
 */

import type { PolarPilotClient } from '../contracts/polarpilot-client.js';
import type { LobsterStatus } from './types.js';

export interface LobstersModuleConfig {
  pilotClient: PolarPilotClient;
}

export function createLobstersModule(config: LobstersModuleConfig) {
  const { pilotClient } = config;

  return {
    async status(projectId: string): Promise<LobsterStatus> {
      return pilotClient.get<LobsterStatus>(`/api/pilot/status/${encodeURIComponent(projectId)}`);
    },

    async statusAll(): Promise<LobsterStatus[]> {
      return pilotClient.get<LobsterStatus[]>('/api/pilot/status');
    },
  };
}

export type LobstersModule = ReturnType<typeof createLobstersModule>;
