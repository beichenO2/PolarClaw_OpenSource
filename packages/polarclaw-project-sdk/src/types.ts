/**
 * polarclaw-project-sdk — shared types
 *
 * These types mirror the server-side SDK types but are standalone
 * (no dependency on the PolarClaw source tree). They are kept in
 * sync with `PolarClaw/src/sdk/types.ts` via contract tests.
 */

export type PolarUserKind = 'human' | 'project';

export interface PolarUserInfo {
  id: string;
  kind: PolarUserKind;
  display_name: string;
  tool_scopes: string[];
  sdk_scopes: string[];
}

export interface ResolveUserResult {
  user: PolarUserInfo;
  source: 'registry' | 'inferred';
}

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

export interface SDKClientConfig {
  baseUrl: string;
  projectId: string;
  timeoutMs?: number;
}

// ─── ComputerUse (sandbox-external browser automation) ─────
// PolarClaw owns Safari-based browser automation on macOS. Other projects
// route browser automation through these calls so their own host
// desktop is never touched and they need no playwright install.

export interface ComputerUseBrowseInput {
  url: string;
  action: string;
  screenshot?: boolean;
}

export interface ComputerUseBrowseResult {
  ok: boolean;
  action_result?: { success: boolean; message?: string };
  page_url?: string;
  page_title?: string;
  screenshot?: string;
  error?: string;
}

export interface ComputerUseScreenshotInput {
  url: string;
  full_page?: boolean;
  observe?: boolean;
}

export interface ComputerUseScreenshotResult {
  ok: boolean;
  screenshot?: string;
  page_url?: string;
  page_title?: string;
  elements?: Array<{ description: string; selector: string }>;
  error?: string;
}

export interface ComputerUseFillFormInput {
  url: string;
  fields: Record<string, string>;
  submit?: boolean;
}

export interface ComputerUseFillFormResult {
  ok: boolean;
  results?: Array<{ field: string; success: boolean; message?: string }>;
  page_url?: string;
  screenshot?: string;
  error?: string;
}
