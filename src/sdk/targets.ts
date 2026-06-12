/**
 * SDK targets module — thin adapter querying PolarPilot contract
 *
 * All target CRUD operations delegate to PolarPilot's HTTP API.
 * PolarClaw never directly reads/writes lobster/targets/ files.
 */

import type { PolarPilotClient } from '../contracts/polarpilot-client.js';
import type { Target, TargetCreateInput, TargetUpdateInput, ArrowLogEntry, RunTestResult } from './types.js';

export interface TargetsModuleConfig {
  pilotClient: PolarPilotClient;
}

export function createTargetsModule(config: TargetsModuleConfig) {
  const { pilotClient } = config;

  return {
    async list(projectId: string): Promise<Target[]> {
      return pilotClient.get<Target[]>(`/api/pilot/targets/${encodeURIComponent(projectId)}`);
    },

    async get(projectId: string, targetId: string): Promise<Target> {
      return pilotClient.get<Target>(
        `/api/pilot/targets/${encodeURIComponent(projectId)}/${encodeURIComponent(targetId)}`,
      );
    },

    async create(projectId: string, input: TargetCreateInput): Promise<Target> {
      return pilotClient.post<Target>(
        `/api/pilot/targets/${encodeURIComponent(projectId)}`,
        input,
      );
    },

    async update(projectId: string, targetId: string, input: TargetUpdateInput): Promise<Target> {
      return pilotClient.put<Target>(
        `/api/pilot/targets/${encodeURIComponent(projectId)}/${encodeURIComponent(targetId)}`,
        input,
      );
    },

    async appendArrowLog(projectId: string, targetId: string, entry: Omit<ArrowLogEntry, 'ts'>): Promise<Target> {
      return pilotClient.post<Target>(
        `/api/pilot/targets/${encodeURIComponent(projectId)}/${encodeURIComponent(targetId)}/arrow-log`,
        entry,
      );
    },

    async moveBoard(projectId: string, targetId: string, board: Target['board']): Promise<Target> {
      return pilotClient.post<Target>(
        `/api/pilot/targets/${encodeURIComponent(projectId)}/${encodeURIComponent(targetId)}/move-board`,
        { board },
      );
    },

    async archive(projectId: string, targetId: string): Promise<Target> {
      return pilotClient.post<Target>(
        `/api/pilot/targets/${encodeURIComponent(projectId)}/${encodeURIComponent(targetId)}/archive`,
      );
    },

    async runTest(projectId: string, targetId: string): Promise<RunTestResult> {
      return pilotClient.post<RunTestResult>(
        `/api/pilot/targets/${encodeURIComponent(projectId)}/${encodeURIComponent(targetId)}/test`,
      );
    },
  };
}

export type TargetsModule = ReturnType<typeof createTargetsModule>;
