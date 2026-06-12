/**
 * PolarClaw SDK — unified type definitions
 *
 * Shared between the internal SDK server and the external
 * `polarclaw-project-sdk` thin client. All public fields are
 * deliberately free of internal DB paths or implementation details.
 */

// ─── Version ──────────────────────────────────────────────

export const SDK_VERSION = '0.1.0' as const;

// ─── PolarUser ────────────────────────────────────────────
// Re-export core types; SDK adds a sanitized view for external callers.

export type { PolarUserKind, PolarUser, PolarUserGroup } from '../core/polar-user.js';

/** Sanitized user info returned by the SDK API (no internal paths). */
export interface PolarUserInfo {
  id: string;
  kind: 'human' | 'project';
  display_name: string;
  tool_scopes: string[];
  sdk_scopes: string[];
}

export interface ResolveUserResult {
  user: PolarUserInfo;
  source: 'registry' | 'inferred';
}

// ─── Lobster Events ───────────────────────────────────────
// Schema aligned with SOTAgent lobster-events.jsonl

export type LobsterEventType =
  | 'bug'
  | 'digist_report'
  | 'contract_red'
  | 'git_push_main'
  | 'scheduled_health_scan'
  | 'build_failure'
  | 'api_5xx'
  | 'cli_nonzero_exit'
  | 'custom';

export type EventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface LobsterEvent {
  ts: string;
  type: LobsterEventType;
  source_project: string;
  target_project?: string;
  severity: EventSeverity;
  dedup_key: string;
  payload: Record<string, unknown>;
}

export interface EmitEventResult {
  accepted: boolean;
  event_id: string;
  dedup_skipped: boolean;
}

// ─── Lobster Status ───────────────────────────────────────

export type LobsterState = 'dormant' | 'active' | 'error' | 'unknown';

export interface LobsterStatus {
  project_id: string;
  state: LobsterState;
  current_node?: string;
  last_active_at?: string;
  active_targets: number;
  completed_targets: number;
  pending_events: number;
}

// ─── Targets ──────────────────────────────────────────────

export type TargetStatus = 'active' | 'hit' | 'moved' | 'archived';
export type TargetBoard = 'backlog' | 'sprint' | 'done' | 'archived';

export interface Target {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: TargetStatus;
  board: TargetBoard;
  polaris_feature_ref?: string;
  arrow_log: ArrowLogEntry[];
  created_at: string;
  updated_at: string;
}

export interface ArrowLogEntry {
  ts: string;
  action: string;
  outcome: string;
  evidence?: string;
}

export interface TargetCreateInput {
  name: string;
  description: string;
  board?: TargetBoard;
  polaris_feature_ref?: string;
}

export interface TargetUpdateInput {
  status?: TargetStatus;
  board?: TargetBoard;
  name?: string;
  description?: string;
}

export interface RunTestResult {
  target_id: string;
  passed: boolean;
  output: string;
  duration_ms: number;
}

// ─── Approvals ────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalRequest {
  id: string;
  project_id: string;
  requester: string;
  action: string;
  description: string;
  status: ApprovalStatus;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
}

export interface ApprovalCallbackPayload {
  approval_id: string;
  status: 'approved' | 'rejected';
  comment?: string;
}

// ─── ComputerUse (sandbox-external service) ───────────────
// Re-export from the implementation module so SDK consumers
// have a single import surface.

export type {
  ComputerUseBrowseInput,
  ComputerUseBrowseResult,
  ComputerUseScreenshotInput,
  ComputerUseScreenshotResult,
  ComputerUseFillFormInput,
  ComputerUseFillFormResult,
} from './computer-use.js';

// ─── SDK Errors ───────────────────────────────────────────

export type SDKErrorCode =
  | 'user_not_found'
  | 'project_not_found'
  | 'target_not_found'
  | 'approval_not_found'
  | 'permission_denied'
  | 'invalid_event'
  | 'dedup_conflict'
  | 'sotagent_unreachable'
  | 'validation_error'
  | 'internal_error';

export class SDKError extends Error {
  constructor(
    public readonly code: SDKErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SDKError';
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

// ─── SDK Client Config ────────────────────────────────────

export interface SDKClientConfig {
  /** PolarClaw base URL (e.g. http://127.0.0.1:3210) */
  baseUrl: string;
  /** Calling project ID for authorization */
  projectId: string;
  /** Request timeout in ms (default 10_000) */
  timeoutMs?: number;
}
