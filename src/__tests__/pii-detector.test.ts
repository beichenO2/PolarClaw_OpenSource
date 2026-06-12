import { describe, it, expect } from 'vitest';
import {
  sanitizePii,
  sanitizeWithCustomEntities,
  desanitize,
  containsPii,
} from '../adapters/privacy/pii-detector.js';

describe('sanitizePii', () => {
  it('detects and replaces phone numbers', () => {
    const result = sanitizePii('联系我 13812345678 谢谢');
    expect(result.sanitized).not.toContain('13812345678');
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.type).toBe('PHONE');
    expect(result.vault.size).toBe(1);
  });

  it('detects email addresses', () => {
    const result = sanitizePii('发到 test@example.com 就行');
    expect(result.sanitized).not.toContain('test@example.com');
    expect(result.entities[0]!.type).toBe('EMAIL');
  });

  it('detects ID card numbers', () => {
    const result = sanitizePii('身份证 110101199901011234');
    expect(result.sanitized).not.toContain('110101199901011234');
    expect(result.entities[0]!.type).toBe('ID_CARD');
  });

  it('detects IP addresses', () => {
    const result = sanitizePii('服务器在 192.168.1.100');
    expect(result.sanitized).not.toContain('192.168.1.100');
    expect(result.entities[0]!.type).toBe('IP_ADDR');
  });

  it('handles multiple PII in one message', () => {
    const result = sanitizePii('手机 13900001111 邮箱 a@b.com');
    expect(result.entities.length).toBeGreaterThanOrEqual(2);
    expect(result.sanitized).not.toContain('13900001111');
    expect(result.sanitized).not.toContain('a@b.com');
  });

  it('returns clean text unchanged', () => {
    const result = sanitizePii('今天天气不错');
    expect(result.sanitized).toBe('今天天气不错');
    expect(result.entities).toHaveLength(0);
  });

  it('reuses existing vault entries for same value', () => {
    const first = sanitizePii('打给 13812345678');
    const second = sanitizePii('再打 13812345678', first.vault);
    expect(second.entities).toHaveLength(0);
    expect(second.vault.size).toBe(1);
  });
});

describe('sanitizeWithCustomEntities', () => {
  it('replaces custom named entities before regex', () => {
    const result = sanitizeWithCustomEntities('张三在北京', [
      { value: '张三', type: 'NAME' },
      { value: '北京', type: 'CITY' },
    ]);
    expect(result.sanitized).not.toContain('张三');
    expect(result.sanitized).not.toContain('北京');
    expect(result.entities.length).toBeGreaterThanOrEqual(2);
  });

  it('skips empty custom values', () => {
    const result = sanitizeWithCustomEntities('你好', [{ value: '', type: 'NAME' }]);
    expect(result.sanitized).toBe('你好');
  });
});

describe('desanitize', () => {
  it('restores placeholders to originals', () => {
    const { sanitized, vault } = sanitizePii('手机 13812345678');
    const restored = desanitize(sanitized, vault);
    expect(restored).toContain('13812345678');
  });

  it('handles empty vault', () => {
    expect(desanitize('hello', new Map())).toBe('hello');
  });
});

describe('containsPii', () => {
  it('returns true when PII present', () => {
    expect(containsPii('号码 13812345678')).toBe(true);
  });

  it('returns false for clean text', () => {
    expect(containsPii('今天天气不错')).toBe(false);
  });
});
