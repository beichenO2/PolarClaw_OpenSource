/**
 * SDK approvals module — thin adapter querying PolarPilot contract
 *
 * All approval operations delegate to PolarPilot's HTTP API.
 * SQLite storage and expiry logic are PolarPilot's responsibility.
 */

import type { PolarPilotClient } from '../contracts/polarpilot-client.js';
import type { ApprovalRequest, ApprovalCallbackPayload } from './types.js';

export interface ApprovalsModuleConfig {
  pilotClient: PolarPilotClient;
}

export function createApprovalsModule(config: ApprovalsModuleConfig) {
  const { pilotClient } = config;

  return {
    async request(input: {
      project_id: string;
      requester: string;
      action: string;
      description?: string;
    }): Promise<ApprovalRequest> {
      return pilotClient.post<ApprovalRequest>('/api/pilot/approvals', input);
    },

    async get(approvalId: string): Promise<ApprovalRequest> {
      return pilotClient.get<ApprovalRequest>(
        `/api/pilot/approvals/${encodeURIComponent(approvalId)}`,
      );
    },

    async listByProject(projectId: string, limit = 50): Promise<ApprovalRequest[]> {
      return pilotClient.get<ApprovalRequest[]>('/api/pilot/approvals', {
        project: projectId,
        limit,
      });
    },

    async listPending(): Promise<ApprovalRequest[]> {
      return pilotClient.get<ApprovalRequest[]>('/api/pilot/approvals/pending');
    },

    async callback(payload: ApprovalCallbackPayload, resolvedBy: string): Promise<ApprovalRequest> {
      return pilotClient.post<ApprovalRequest>(
        `/api/pilot/approvals/${encodeURIComponent(payload.approval_id)}/callback`,
        { status: payload.status, comment: payload.comment, resolved_by: resolvedBy },
      );
    },

    async expireStale(): Promise<number> {
      const result = await pilotClient.post<{ expired: number }>('/api/pilot/approvals/expire-stale');
      return result.expired;
    },
  };
}

export type ApprovalsModule = ReturnType<typeof createApprovalsModule>;
