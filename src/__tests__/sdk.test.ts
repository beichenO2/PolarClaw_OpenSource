import { describe, it, expect } from 'vitest';
import { createPolarUserRegistry } from '../core/polar-user.js';
import { createPolarClawSDK } from '../sdk/index.js';

/**
 * SDK tests — post de-pilot-ification.
 *
 * Events, lobsters, targets, and approvals modules now delegate to
 * PolarPilot's HTTP API via PolarPilotClient. Only the users module
 * (local registry, no network) can be unit-tested without a running
 * PolarPilot instance. Integration tests for the HTTP modules belong
 * in PolarPilot's test suite.
 */

function makeSDK() {
  const userRegistry = createPolarUserRegistry();
  return createPolarClawSDK({
    userRegistry,
    polarpilotUrl: 'http://127.0.0.1:4900',
  });
}

// ── Users (local registry — no network dependency) ───────

describe('sdk.users', () => {
  it('resolves admin as human', () => {
    const sdk = makeSDK();
    const result = sdk.users.resolve('admin');
    expect(result.user.kind).toBe('human');
    expect(result.user.display_name).toBe('Admin');
    expect(result.source).toBe('registry');
  });

  it('resolves project:knowlever as project', () => {
    const sdk = makeSDK();
    const result = sdk.users.resolve('project:knowlever');
    expect(result.user.kind).toBe('project');
    expect(result.user.id).toBe('project:knowlever');
    expect(result.source).toBe('registry');
  });

  it('sanitizes user — no persona path or memory_namespace leaked', () => {
    const sdk = makeSDK();
    const result = sdk.users.resolve('admin');
    const keys = Object.keys(result.user);
    expect(keys).not.toContain('persona');
    expect(keys).not.toContain('memory_namespace');
    expect(keys).not.toContain('group');
    expect(keys).not.toContain('project_id');
  });

  it('lists projects and humans', () => {
    const sdk = makeSDK();
    expect(sdk.users.listProjects().length).toBeGreaterThan(0);
    expect(sdk.users.listHumans().length).toBeGreaterThan(0);
  });
});

// ── Contract: no internal path leaks ─────────────────────

describe('contract: no internal path leaks', () => {
  it('user resolution does not leak persona path', () => {
    const sdk = makeSDK();
    const result = sdk.users.resolve('admin');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('.md');
    expect(serialized).not.toContain('/personas/');
    expect(serialized).not.toContain('memory_namespace');
  });
});

// ── SDK facade shape ─────────────────────────────────────

describe('sdk facade', () => {
  it('exposes expected modules', () => {
    const sdk = makeSDK();
    expect(sdk.version).toBeTruthy();
    expect(sdk.users).toBeDefined();
    expect(sdk.events).toBeDefined();
    expect(sdk.lobsters).toBeDefined();
    expect(sdk.targets).toBeDefined();
    expect(sdk.approvals).toBeDefined();
  });

  it('events module has emit and query methods', () => {
    const sdk = makeSDK();
    expect(typeof sdk.events.emit).toBe('function');
    expect(typeof sdk.events.query).toBe('function');
  });

  it('lobsters module has status and statusAll methods', () => {
    const sdk = makeSDK();
    expect(typeof sdk.lobsters.status).toBe('function');
    expect(typeof sdk.lobsters.statusAll).toBe('function');
  });

  it('targets module has CRUD methods', () => {
    const sdk = makeSDK();
    expect(typeof sdk.targets.list).toBe('function');
    expect(typeof sdk.targets.get).toBe('function');
    expect(typeof sdk.targets.create).toBe('function');
    expect(typeof sdk.targets.update).toBe('function');
  });

  it('approvals module has request and callback methods', () => {
    const sdk = makeSDK();
    expect(typeof sdk.approvals.request).toBe('function');
    expect(typeof sdk.approvals.callback).toBe('function');
    expect(typeof sdk.approvals.listPending).toBe('function');
  });
});
