/**
 * polarclaw-project-sdk — thin HTTP client
 *
 * Usage:
 *   import { createPolarClawClient } from 'polarclaw-project-sdk';
 *   const sdk = createPolarClawClient({ baseUrl: 'http://127.0.0.1:3910', projectId: 'knowlever' });
 *   await sdk.events.emit({ ... });
 *   const status = await sdk.lobsters.status('knowlever');
 */

import type {
  SDKClientConfig,
  PolarUserInfo,
  ResolveUserResult,
  LobsterEvent,
  EmitEventResult,
  LobsterStatus,
  Target,
  TargetCreateInput,
  TargetUpdateInput,
  ArrowLogEntry,
  RunTestResult,
  ApprovalRequest,
  ComputerUseBrowseInput,
  ComputerUseBrowseResult,
  ComputerUseScreenshotInput,
  ComputerUseScreenshotResult,
  ComputerUseFillFormInput,
  ComputerUseFillFormResult,
} from './types.js';

export type * from './types.js';

class SDKClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SDKClientError';
  }
}

export { SDKClientError };

export function createPolarClawClient(config: SDKClientConfig) {
  const { baseUrl, projectId, timeoutMs = 10_000 } = config;
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-PolarClaw-Project': projectId,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await res.json() as T & { error?: string; code?: string };

      if (!res.ok) {
        throw new SDKClientError(
          data.code ?? 'unknown',
          data.error ?? `HTTP ${res.status}`,
          res.status,
          data as Record<string, unknown>,
        );
      }

      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    version() {
      return request<{ version: string }>('GET', '/api/sdk/version');
    },

    users: {
      resolve(userId: string) {
        return request<ResolveUserResult>('GET', `/api/sdk/users/${encodeURIComponent(userId)}`);
      },
      list() {
        return request<{ humans: PolarUserInfo[]; projects: PolarUserInfo[] }>('GET', '/api/sdk/users');
      },
    },

    events: {
      emit(event: LobsterEvent) {
        return request<EmitEventResult>('POST', '/api/sdk/events', event);
      },
      query(opts?: { project?: string; since?: string; limit?: number }) {
        const params = new URLSearchParams();
        if (opts?.project) params.set('project', opts.project);
        if (opts?.since) params.set('since', opts.since);
        if (opts?.limit) params.set('limit', String(opts.limit));
        const qs = params.toString();
        return request<LobsterEvent[]>('GET', `/api/sdk/events${qs ? `?${qs}` : ''}`);
      },
    },

    lobsters: {
      status(lobsterProjectId: string) {
        return request<LobsterStatus>('GET', `/api/sdk/lobsters/${encodeURIComponent(lobsterProjectId)}/status`);
      },
      statusAll() {
        return request<LobsterStatus[]>('GET', '/api/sdk/lobsters');
      },
    },

    targets: {
      list(targetProjectId: string) {
        return request<Target[]>('GET', `/api/sdk/targets/${encodeURIComponent(targetProjectId)}`);
      },
      get(targetProjectId: string, targetId: string) {
        return request<Target>('GET', `/api/sdk/targets/${encodeURIComponent(targetProjectId)}/${encodeURIComponent(targetId)}`);
      },
      create(targetProjectId: string, input: TargetCreateInput) {
        return request<Target>('POST', `/api/sdk/targets/${encodeURIComponent(targetProjectId)}`, input);
      },
      update(targetProjectId: string, targetId: string, input: TargetUpdateInput) {
        return request<Target>('PUT', `/api/sdk/targets/${encodeURIComponent(targetProjectId)}/${encodeURIComponent(targetId)}`, input);
      },
      appendArrowLog(targetProjectId: string, targetId: string, entry: Omit<ArrowLogEntry, 'ts'>) {
        return request<Target>('POST', `/api/sdk/targets/${encodeURIComponent(targetProjectId)}/${encodeURIComponent(targetId)}/arrow`, entry);
      },
      runTest(targetProjectId: string, targetId: string) {
        return request<RunTestResult>('POST', `/api/sdk/targets/${encodeURIComponent(targetProjectId)}/${encodeURIComponent(targetId)}/test`);
      },
    },

    approvals: {
      request(input: { action: string; description?: string }) {
        return request<ApprovalRequest>('POST', '/api/sdk/approvals', {
          project_id: projectId,
          requester: `project:${projectId}`,
          ...input,
        });
      },
      get(approvalId: string) {
        return request<ApprovalRequest>('GET', `/api/sdk/approvals/${encodeURIComponent(approvalId)}`);
      },
      listPending() {
        return request<ApprovalRequest[]>('GET', '/api/sdk/approvals/pending');
      },
      callback(approvalId: string, status: 'approved' | 'rejected', comment?: string) {
        return request<ApprovalRequest>('POST', `/api/sdk/approvals/${encodeURIComponent(approvalId)}/callback`, {
          status,
          comment,
          resolved_by: `project:${projectId}`,
        });
      },
    },

    // PolarClaw-hosted browser automation. The host PolarClaw container
    // PolarClaw owns Safari browser automation; callers never launch Chrome/Playwright.
    computerUse: {
      browse(input: ComputerUseBrowseInput) {
        return request<ComputerUseBrowseResult>('POST', '/api/sdk/computer-use/browse', input);
      },
      screenshot(input: ComputerUseScreenshotInput) {
        return request<ComputerUseScreenshotResult>('POST', '/api/sdk/computer-use/screenshot', input);
      },
      fillForm(input: ComputerUseFillFormInput) {
        return request<ComputerUseFillFormResult>('POST', '/api/sdk/computer-use/fill-form', input);
      },
    },
  };
}

export type PolarClawClient = ReturnType<typeof createPolarClawClient>;
