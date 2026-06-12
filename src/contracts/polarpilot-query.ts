/**
 * PolarPilot Query Contract — TypeScript interface
 *
 * Defines the contract between PolarClaw (consumer/interactive hub)
 * and PolarPilot (provider/autonomous guardian) for status, target,
 * event, and approval queries via HTTP.
 *
 * PolarClaw SDK modules call this contract instead of internal stores.
 * PolarPilot implements these endpoints.
 */

// ─── Status Contract ─────────────────────────────────────

export type PilotState = 'dormant' | 'active' | 'error' | 'unknown';

export interface PilotStatusResponse {
  project_id: string;
  state: PilotState;
  current_node?: string;
  last_active_at?: string;
  active_targets: number;
  completed_targets: number;
  pending_events: number;
}

export interface PilotHealthResponse {
  healthy: boolean;
  uptime_ms: number;
  projects_monitored: number;
  last_scan_at?: string;
}

// ─── Targets Contract ────────────────────────────────────

export type TargetStatus = 'active' | 'hit' | 'moved' | 'archived';
export type TargetBoard = 'backlog' | 'sprint' | 'done' | 'archived';

export interface PilotTarget {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: TargetStatus;
  board: TargetBoard;
  polaris_feature_ref?: string;
  arrow_log: PilotArrowLogEntry[];
  created_at: string;
  updated_at: string;
}

export interface PilotArrowLogEntry {
  ts: string;
  action: string;
  outcome: string;
  evidence?: string;
}

export interface PilotTargetCreateRequest {
  name: string;
  description: string;
  board?: TargetBoard;
  polaris_feature_ref?: string;
}

export interface PilotTargetUpdateRequest {
  status?: TargetStatus;
  board?: TargetBoard;
  name?: string;
  description?: string;
}

export interface PilotArrowLogRequest {
  action: string;
  outcome: string;
  evidence?: string;
}

export interface PilotRunTestResponse {
  target_id: string;
  passed: boolean;
  output: string;
  duration_ms: number;
}

// ─── Events Contract ─────────────────────────────────────

export type PilotEventType =
  | 'bug'
  | 'digist_report'
  | 'contract_red'
  | 'git_push_main'
  | 'scheduled_health_scan'
  | 'build_failure'
  | 'api_5xx'
  | 'cli_nonzero_exit'
  | 'custom';

export type PilotEventSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface PilotEvent {
  ts: string;
  type: PilotEventType;
  source_project: string;
  target_project?: string;
  severity: PilotEventSeverity;
  dedup_key: string;
  payload: Record<string, unknown>;
}

export interface PilotEmitEventResponse {
  accepted: boolean;
  event_id: string;
  dedup_skipped: boolean;
}

export interface PilotQueryEventsRequest {
  project?: string;
  since?: string;
  limit?: number;
}

// ─── Approvals Contract ──────────────────────────────────

export type PilotApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PilotApprovalRequest {
  id: string;
  project_id: string;
  requester: string;
  action: string;
  description: string;
  status: PilotApprovalStatus;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
}

export interface PilotApprovalCreateRequest {
  project_id: string;
  requester: string;
  action: string;
  description?: string;
}

export interface PilotApprovalCallbackRequest {
  status: 'approved' | 'rejected';
  comment?: string;
}

// ─── Contract Error ──────────────────────────────────────

export interface PilotContractError {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

// ─── Endpoint Map ────────────────────────────────────────

/**
 * PolarPilot HTTP API Endpoint Map
 *
 * Status:
 *   GET  /api/pilot/status/:projectId  → PilotStatusResponse
 *   GET  /api/pilot/status             → PilotStatusResponse[]
 *   GET  /api/pilot/health             → PilotHealthResponse
 *
 * Targets:
 *   GET  /api/pilot/targets/:projectId                       → PilotTarget[]
 *   GET  /api/pilot/targets/:projectId/:targetId             → PilotTarget
 *   POST /api/pilot/targets/:projectId                       → PilotTarget
 *   PUT  /api/pilot/targets/:projectId/:targetId             → PilotTarget
 *   POST /api/pilot/targets/:projectId/:targetId/arrow-log   → PilotTarget
 *   POST /api/pilot/targets/:projectId/:targetId/move-board  → PilotTarget
 *   POST /api/pilot/targets/:projectId/:targetId/test        → PilotRunTestResponse
 *   POST /api/pilot/targets/:projectId/:targetId/archive     → PilotTarget
 *
 * Events:
 *   POST /api/pilot/events             → PilotEmitEventResponse
 *   GET  /api/pilot/events             → PilotEvent[]
 *
 * Approvals:
 *   POST /api/pilot/approvals                     → PilotApprovalRequest
 *   GET  /api/pilot/approvals/:id                 → PilotApprovalRequest
 *   GET  /api/pilot/approvals?project=&limit=     → PilotApprovalRequest[]
 *   GET  /api/pilot/approvals/pending             → PilotApprovalRequest[]
 *   POST /api/pilot/approvals/:id/callback        → PilotApprovalRequest
 *   POST /api/pilot/approvals/expire-stale        → { expired: number }
 */
