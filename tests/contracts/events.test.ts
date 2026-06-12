/**
 * Contract test — polarpilot-events.schema.json
 */

import { describe, it, expect } from 'vitest';
import { loadSchema, compileDefinition } from './schema-helper.js';

const schema = loadSchema('polarpilot-events.schema.json');

describe('contract: polarpilot-events schema', () => {
  it('schema file is valid JSON Schema draft-07', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.definitions).toBeDefined();
  });

  it('PilotEvent example validates', () => {
    const validate = compileDefinition(schema, 'PilotEvent');

    const payload = {
      ts: '2026-05-03T01:00:00Z',
      type: 'build_failure',
      source_project: 'knowlever',
      severity: 'error',
      dedup_key: 'knowlever-build-2026-05-03',
      payload: { exit_code: 1, command: 'npm run build' },
    };

    expect(validate(payload)).toBe(true);
  });

  it('accepts all valid event types', () => {
    const validate = compileDefinition(schema, 'PilotEvent');

    const types = [
      'bug', 'digist_report', 'contract_red', 'git_push_main',
      'scheduled_health_scan', 'build_failure', 'api_5xx',
      'cli_nonzero_exit', 'custom',
    ];

    for (const type of types) {
      const ev = {
        ts: '2026-05-03T01:00:00Z',
        type,
        source_project: 'test',
        severity: 'info',
        dedup_key: `test-${type}`,
        payload: {},
      };
      expect(validate(ev)).toBe(true);
    }
  });

  it('rejects invalid event type', () => {
    const validate = compileDefinition(schema, 'PilotEvent');

    const bad = {
      ts: '2026-05-03T01:00:00Z',
      type: 'INVALID_TYPE',
      source_project: 'test',
      severity: 'info',
      dedup_key: 'test',
      payload: {},
    };

    expect(validate(bad)).toBe(false);
  });

  it('rejects invalid severity', () => {
    const validate = compileDefinition(schema, 'PilotEvent');

    const bad = {
      ts: '2026-05-03T01:00:00Z',
      type: 'bug',
      source_project: 'test',
      severity: 'INVALID',
      dedup_key: 'test',
      payload: {},
    };

    expect(validate(bad)).toBe(false);
  });

  it('EmitEventResponse validates', () => {
    const validate = compileDefinition(schema, 'EmitEventResponse');
    expect(validate({ accepted: true, event_id: 'evt-123', dedup_skipped: false })).toBe(true);
    expect(validate({})).toBe(false);
  });

  it('schema-embedded emit example validates', () => {
    const examples = schema.examples as Record<string, unknown>;
    const validate = compileDefinition(schema, 'EmitEventResponse');
    expect(validate(examples.emit_response)).toBe(true);
  });
});
