/**
 * PolarClaw SDK — server-side entry point
 *
 * Assembles all SDK modules into a single facade. SDK modules are thin
 * adapters that call PolarPilot's HTTP contract — no internal stores.
 * External projects use the `polarclaw-project-sdk` HTTP client instead.
 */

import type { PolarUserRegistry } from '../core/polar-user.js';
import { PolarPilotClient } from '../contracts/polarpilot-client.js';
import { createUsersModule } from './users.js';
import { createEventsModule } from './events.js';
import { createLobstersModule } from './lobsters.js';
import { createTargetsModule } from './targets.js';
import { createApprovalsModule } from './approvals.js';
import { createComputerUseModule } from './computer-use.js';
import { SDK_VERSION } from './types.js';

export interface PolarClawSDKConfig {
  userRegistry: PolarUserRegistry;
  /** PolarPilot base URL for contract calls (e.g. http://127.0.0.1:4900) */
  polarpilotUrl: string;
  /** HTTP request timeout in ms for PolarPilot calls (default 10_000) */
  polarpilotTimeoutMs?: number;
}

export function createPolarClawSDK(config: PolarClawSDKConfig) {
  const pilotClient = new PolarPilotClient({
    baseUrl: config.polarpilotUrl,
    timeoutMs: config.polarpilotTimeoutMs,
  });

  const users = createUsersModule({ registry: config.userRegistry });
  const events = createEventsModule({ pilotClient });
  const lobsters = createLobstersModule({ pilotClient });
  const targets = createTargetsModule({ pilotClient });
  const approvals = createApprovalsModule({ pilotClient });
  const computerUse = createComputerUseModule();

  return {
    version: SDK_VERSION,
    users,
    events,
    lobsters,
    targets,
    approvals,
    computerUse,
  };
}

export type PolarClawSDK = ReturnType<typeof createPolarClawSDK>;

export { SDK_VERSION, SDKError } from './types.js';
export type {
  PolarUserInfo,
  ResolveUserResult,
  LobsterEvent,
  LobsterEventType,
  EventSeverity,
  EmitEventResult,
  LobsterStatus,
  LobsterState,
  Target,
  TargetCreateInput,
  TargetUpdateInput,
  ArrowLogEntry,
  RunTestResult,
  ApprovalRequest,
  ApprovalCallbackPayload,
  ApprovalStatus,
  ComputerUseBrowseInput,
  ComputerUseBrowseResult,
  ComputerUseScreenshotInput,
  ComputerUseScreenshotResult,
  ComputerUseFillFormInput,
  ComputerUseFillFormResult,
  SDKErrorCode,
  SDKClientConfig,
} from './types.js';

