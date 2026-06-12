import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createUsersModule } from '../sdk/users.js';
import { createEventsModule } from '../sdk/events.js';
import { createLobstersModule } from '../sdk/lobsters.js';
import { createTargetsModule } from '../sdk/targets.js';
import { createApprovalsModule } from '../sdk/approvals.js';
import { createPolarUserRegistry } from '../core/polar-user.js';
import type { PolarPilotClient } from '../contracts/polarpilot-client.js';
import type { LobsterEvent } from '../sdk/types.js';

// Mock PolarPilotClient
function createMockPilotClient() {
  return {
    get: vi.fn(),
    post: vi.fn(),
  } as unknown as PolarPilotClient;
}

describe('R8: SDK/API', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── users.resolve ────────────────────────────────────────
  describe('users.resolve', () => {
    it('resolves admin user via registry', () => {
      const registry = createPolarUserRegistry();
      const users = createUsersModule({ registry });
      const result = users.resolve('admin');

      expect(result).toBeDefined();
      expect(result.user.kind).toBe('human');
      expect(result.user.display_name).toBe('Admin');
    });

    it('resolves project user via registry', () => {
      const registry = createPolarUserRegistry();
      const users = createUsersModule({ registry });
      const result = users.resolve('project:knowlever');

      expect(result).toBeDefined();
      expect(result.user.kind).toBe('project');
    });

    it('resolves unknown human user with wildcard scope', () => {
      const registry = createPolarUserRegistry();
      const users = createUsersModule({ registry });
      const result = users.resolve('someone');

      expect(result).toBeDefined();
      expect(result.user.kind).toBe('human');
      expect(result.user.tool_scopes).toContain('*');
    });
  });

  // ── events.emit ──────────────────────────────────────────
  describe('events.emit', () => {
    it('emits an event via pilotClient and returns result', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accepted: true,
        event_id: 'evt-1',
        dedup_skipped: false,
      });

      const events = createEventsModule({ pilotClient });
      const event: LobsterEvent = {
        ts: new Date().toISOString(),
        type: 'custom',
        source_project: 'polarclaw',
        target_project: 'polarpilot',
        severity: 'info',
        dedup_key: 'test-1',
        payload: { message: 'test event' },
      };
      const result = await events.emit(event);
      expect(result.accepted).toBe(true);
      expect(result.event_id).toBe('evt-1');
      expect(pilotClient.post).toHaveBeenCalledWith('/api/pilot/events', expect.any(Object));
    });

    it('handles dedup skip', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        accepted: false,
        event_id: '',
        dedup_skipped: true,
      });

      const events = createEventsModule({ pilotClient });
      const event: LobsterEvent = {
        ts: new Date().toISOString(),
        type: 'custom',
        source_project: 'polarclaw',
        severity: 'info',
        dedup_key: 'dup-1',
        payload: {},
      };
      const result = await events.emit(event);
      expect(result.dedup_skipped).toBe(true);
    });
  });

  // ── lobsters.status ──────────────────────────────────────
  describe('lobsters.status', () => {
    it('returns status for a project', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        project_id: 'polarpilot',
        state: 'active',
        current_node: 'FindTarget',
        active_targets: 3,
        completed_targets: 1,
        pending_events: 0,
      });

      const lobsters = createLobstersModule({ pilotClient });
      const result = await lobsters.status('polarpilot');
      expect(result.state).toBe('active');
      expect(result.active_targets).toBe(3);
    });

    it('returns statusAll for all projects', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { project_id: 'polarpilot', state: 'active' },
        { project_id: 'knowlever', state: 'dormant' },
      ]);

      const lobsters = createLobstersModule({ pilotClient });
      const result = await lobsters.statusAll();
      expect(result.length).toBe(2);
    });
  });

  // ── targets.* ────────────────────────────────────────────
  describe('targets', () => {
    it('creates a target', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 't1',
        project_id: 'polarpilot',
        name: 'Test Target',
        status: 'active',
      });

      const targets = createTargetsModule({ pilotClient });
      const result = await targets.create('polarpilot', {
        name: 'Test Target',
        description: 'A test target',
      });
      expect(result.name).toBe('Test Target');
    });

    it('lists targets for a project', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 't1', name: 'Target 1', status: 'active' },
      ]);

      const targets = createTargetsModule({ pilotClient });
      const result = await targets.list('polarpilot');
      expect(result.length).toBe(1);
    });

    it('gets a target by id', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 't1',
        name: 'Target 1',
        status: 'active',
      });

      const targets = createTargetsModule({ pilotClient });
      const result = await targets.get('polarpilot', 't1');
      expect(result.id).toBe('t1');
    });
  });

  // ── approvals ────────────────────────────────────────────
  describe('approvals', () => {
    it('requests approval', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 'apr-1',
        project_id: 'polarpilot',
        requester: 'admin',
        action: 'deploy',
        status: 'pending',
        created_at: new Date().toISOString(),
      });

      const approvals = createApprovalsModule({ pilotClient });
      const result = await approvals.request({
        project_id: 'polarpilot',
        requester: 'admin',
        action: 'deploy',
        description: 'Deploy to production',
      });
      expect(result.status).toBe('pending');
    });

    it('lists pending approvals', async () => {
      const pilotClient = createMockPilotClient();
      (pilotClient.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'apr-1', status: 'pending' },
        { id: 'apr-2', status: 'pending' },
      ]);

      const approvals = createApprovalsModule({ pilotClient });
      const result = await approvals.listPending();
      expect(result.length).toBe(2);
    });
  });
});