/**
 * Contract test — polarpilot-status.schema.json
 */

import { describe, it, expect } from 'vitest';
import { loadSchema, compileDefinition } from './schema-helper.js';

const schema = loadSchema('polarpilot-status.schema.json');

describe('contract: polarpilot-status schema', () => {
  it('schema file is valid JSON Schema draft-07', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.definitions).toBeDefined();
  });

  it('PilotStatusResponse example validates', () => {
    const validate = compileDefinition(schema, 'PilotStatusResponse');

    const payload = {
      project_id: 'knowlever',
      state: 'active',
      current_node: 'compile-pipeline',
      last_active_at: '2026-05-03T01:00:00Z',
      active_targets: 3,
      completed_targets: 12,
      pending_events: 1,
    };

    expect(validate(payload)).toBe(true);
  });

  it('rejects invalid state enum', () => {
    const validate = compileDefinition(schema, 'PilotStatusResponse');

    const bad = {
      project_id: 'x',
      state: 'NOT_A_STATE',
      active_targets: 0,
      completed_targets: 0,
      pending_events: 0,
    };

    expect(validate(bad)).toBe(false);
  });

  it('rejects missing required fields', () => {
    const validate = compileDefinition(schema, 'PilotStatusResponse');
    expect(validate({ project_id: 'x' })).toBe(false);
    expect(validate.errors!.some(e => e.keyword === 'required')).toBe(true);
  });

  it('PilotHealthResponse validates', () => {
    const validate = compileDefinition(schema, 'PilotHealthResponse');

    expect(validate({
      healthy: true,
      uptime_ms: 3600000,
      projects_monitored: 5,
      last_scan_at: '2026-05-03T01:00:00Z',
    })).toBe(true);

    expect(validate({ healthy: true })).toBe(false);
  });

  it('schema-embedded status example validates', () => {
    const examples = schema.examples as Record<string, unknown>;
    const validate = compileDefinition(schema, 'PilotStatusResponse');
    expect(validate(examples.status_response)).toBe(true);
  });

  it('schema-embedded health example validates', () => {
    const examples = schema.examples as Record<string, unknown>;
    const validate = compileDefinition(schema, 'PilotHealthResponse');
    expect(validate(examples.health_response)).toBe(true);
  });
});
