/**
 * Contract test — polarpilot-approvals.schema.json
 */

import { describe, it, expect } from 'vitest';
import { loadSchema, compileDefinition } from './schema-helper.js';

const schema = loadSchema('polarpilot-approvals.schema.json');

describe('contract: polarpilot-approvals schema', () => {
  it('schema file is valid JSON Schema draft-07', () => {
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.definitions).toBeDefined();
  });

  it('PilotApprovalRequest example validates', () => {
    const validate = compileDefinition(schema, 'PilotApprovalRequest');

    const payload = {
      id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
      project_id: 'knowlever',
      requester: 'project:knowlever',
      action: 'deploy_wiki',
      description: 'Deploy updated wiki to production',
      status: 'pending',
      created_at: '2026-05-03T01:00:00Z',
    };

    expect(validate(payload)).toBe(true);
  });

  it('accepts all valid approval statuses', () => {
    const validate = compileDefinition(schema, 'PilotApprovalRequest');

    for (const status of ['pending', 'approved', 'rejected', 'expired']) {
      const payload = {
        id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
        project_id: 'test',
        requester: 'user:test',
        action: 'deploy',
        description: 'test',
        status,
        created_at: '2026-05-03T01:00:00Z',
      };
      expect(validate(payload)).toBe(true);
    }
  });

  it('rejects invalid approval status', () => {
    const validate = compileDefinition(schema, 'PilotApprovalRequest');

    const bad = {
      id: 'x',
      project_id: 'test',
      requester: 'user:test',
      action: 'deploy',
      description: 'test',
      status: 'INVALID_STATUS',
      created_at: '2026-05-03T01:00:00Z',
    };

    expect(validate(bad)).toBe(false);
  });

  it('rejects missing required fields', () => {
    const validate = compileDefinition(schema, 'PilotApprovalRequest');
    expect(validate({})).toBe(false);
    expect(validate.errors!.some(e => e.keyword === 'required')).toBe(true);
  });

  it('ApprovalCreateRequest validates minimal payload', () => {
    const validate = compileDefinition(schema, 'ApprovalCreateRequest');
    expect(validate({ project_id: 'x', requester: 'user:x', action: 'deploy' })).toBe(true);
    expect(validate({})).toBe(false);
  });

  it('ApprovalCallbackRequest validates', () => {
    const validate = compileDefinition(schema, 'ApprovalCallbackRequest');
    expect(validate({ status: 'approved' })).toBe(true);
    expect(validate({ status: 'rejected', comment: 'not ready' })).toBe(true);
    expect(validate({ status: 'INVALID' })).toBe(false);
    expect(validate({})).toBe(false);
  });

  it('schema-embedded example matches PilotApprovalRequest', () => {
    const examples = schema.examples as Record<string, unknown>;
    const validate = compileDefinition(schema, 'PilotApprovalRequest');
    expect(validate(examples.create_response)).toBe(true);
  });
});
