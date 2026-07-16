import { describe, expect, it } from 'vitest';
import { resolveManagedPort } from '../runtime-governance.js';

describe('resolveManagedPort', () => {
  it('rejects startup outside PolarProcess', () => {
    expect(() => resolveManagedPort({ PORT: '3910' })).toThrow(
      'PolarClaw must be started by PolarProcess',
    );
  });

  it('rejects invalid and mismatched injected ports', () => {
    expect(() => resolveManagedPort({ POLAR_RUNTIME_MANAGED: '1', PORT: 'bad' })).toThrow(
      'valid injected PORT',
    );
    expect(() => resolveManagedPort({ POLAR_RUNTIME_MANAGED: '1', PORT: '3911' })).toThrow(
      'does not match preferred port 3910',
    );
  });

  it('accepts the canonical managed port', () => {
    expect(resolveManagedPort({ POLAR_RUNTIME_MANAGED: '1', PORT: '3910' })).toBe(3910);
  });
});
