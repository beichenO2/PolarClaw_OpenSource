/**
 * SDK events module — thin adapter querying PolarPilot contract
 *
 * All event operations (emit + query) delegate to PolarPilot's HTTP API.
 * Dedup, dual-channel routing, and local file management are PolarPilot's
 * responsibility — this module only forwards requests.
 */

import type { PolarPilotClient } from '../contracts/polarpilot-client.js';
import type { LobsterEvent, EmitEventResult, LobsterEventType, EventSeverity } from './types.js';

export interface EventsModuleConfig {
  pilotClient: PolarPilotClient;
}

export function createEventsModule(config: EventsModuleConfig) {
  const { pilotClient } = config;

  return {
    async emit(event: LobsterEvent): Promise<EmitEventResult> {
      const fullEvent: LobsterEvent = {
        ...event,
        ts: event.ts || new Date().toISOString(),
      };
      return pilotClient.post<EmitEventResult>('/api/pilot/events', fullEvent);
    },

    async query(opts: { project?: string; since?: string; limit?: number }): Promise<LobsterEvent[]> {
      return pilotClient.get<LobsterEvent[]>('/api/pilot/events', {
        project: opts.project,
        since: opts.since,
        limit: opts.limit,
      });
    },

    createEvent(
      type: LobsterEventType,
      sourceProject: string,
      severity: EventSeverity,
      dedupKey: string,
      payload: Record<string, unknown>,
      targetProject?: string,
    ): LobsterEvent {
      return {
        ts: new Date().toISOString(),
        type,
        source_project: sourceProject,
        target_project: targetProject,
        severity,
        dedup_key: dedupKey,
        payload,
      };
    },
  };
}

export type EventsModule = ReturnType<typeof createEventsModule>;
