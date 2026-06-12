/**
 * Contract test — polarpilot-targets.schema.json
 */

import { describe, it, expect } from 'vitest';
import { loadSchema, compileDefinition } from './schema-helper.js';

const schema = loadSchema('polarpilot-targets.schema.json');

describe('contract: polarpilot-targets schema', () => {
  it('schema file is valid JSON Schema draft-07', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.definitions).toBeDefined();
  });

  it('PilotTarget example payload validates', () => {
    const validate = compileDefinition(schema, 'PilotTarget');

    const payload = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      project_id: 'knowlever',
      name: 'Fix compile timeout',
      description: 'Compile pipeline times out on large topic sets',
      status: 'active',
      board: 'sprint',
      polaris_feature_ref: 'R1/wiki-compile',
      arrow_log: [
        { ts: '2026-05-03T01:00:00Z', action: 'investigation', outcome: 'identified bottleneck' },
      ],
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T01:00:00Z',
    };

    expect(validate(payload)).toBe(true);
  });

  it('rejects invalid status enum', () => {
    const validate = compileDefinition(schema, 'PilotTarget');

    const bad = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      project_id: 'x',
      name: 'test',
      description: '',
      status: 'INVALID',
      board: 'sprint',
      arrow_log: [],
      created_at: '2026-05-03T00:00:00Z',
      updated_at: '2026-05-03T01:00:00Z',
    };

    expect(validate(bad)).toBe(false);
  });

  it('rejects missing required fields', () => {
    const validate = compileDefinition(schema, 'PilotTarget');
    expect(validate({})).toBe(false);
    expect(validate.errors!.some(e => e.keyword === 'required')).toBe(true);
  });

  it('TargetCreateRequest validates minimal payload', () => {
    const validate = compileDefinition(schema, 'TargetCreateRequest');
    expect(validate({ name: 'Test', description: 'Desc' })).toBe(true);
    expect(validate({})).toBe(false);
  });

  it('RunTestResponse validates', () => {
    const validate = compileDefinition(schema, 'RunTestResponse');
    expect(validate({ target_id: 't1', passed: true, output: 'ok', duration_ms: 150 })).toBe(true);
    expect(validate({ target_id: 't1', passed: true, output: 'ok', duration_ms: -1 })).toBe(false);
  });

  it('schema-embedded example matches PilotTarget', () => {
    const examples = schema.examples as Record<string, unknown>;
    const validate = compileDefinition(schema, 'PilotTarget');
    expect(validate(examples.create_response)).toBe(true);
  });
});
