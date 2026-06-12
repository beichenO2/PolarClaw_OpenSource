import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createThinkingTemplateGenerator, type IThinkingTemplate } from './thinking-template-generator.js';
import type { IArrowPattern } from './pattern-detector.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('ThinkingTemplateGenerator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'template-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('generateFromArrowPattern', () => {
    it('should generate template from high hit rate pattern', () => {
      const generator = createThinkingTemplateGenerator({ patternsDir: tempDir });

      const pattern: IArrowPattern = {
        name: 'modify-pattern',
        deltaPattern: '修改了 {file} 的 {function}',
        hitRate: 0.8,
        occurrences: 10,
        hits: 8,
      };

      const template = generator.generateFromArrowPattern(pattern);

      expect(template).not.toBeNull();
      expect(template?.name).toContain('learned-');
      expect(template?.tags).toContain('modify');
      expect(template?.steps.length).toBeGreaterThan(0);
    });

    it('should return null for low hit rate pattern', () => {
      const generator = createThinkingTemplateGenerator({ patternsDir: tempDir, minHitRate: 0.8 });

      const pattern: IArrowPattern = {
        name: 'low-rate',
        deltaPattern: 'some pattern',
        hitRate: 0.5,
        occurrences: 10,
        hits: 5,
      };

      const template = generator.generateFromArrowPattern(pattern);

      expect(template).toBeNull();
    });

    it('should return null for low occurrences', () => {
      const generator = createThinkingTemplateGenerator({ patternsDir: tempDir, minOccurrences: 5 });

      const pattern: IArrowPattern = {
        name: 'low-occurrences',
        deltaPattern: 'some pattern',
        hitRate: 0.9,
        occurrences: 2,
        hits: 2,
      };

      const template = generator.generateFromArrowPattern(pattern);

      expect(template).toBeNull();
    });
  });

  describe('generateAndSave', () => {
    it('should save template to file', () => {
      const generator = createThinkingTemplateGenerator({ patternsDir: tempDir });

      const pattern: IArrowPattern = {
        name: 'test-pattern',
        deltaPattern: '新增了 {file}',
        hitRate: 0.9,
        occurrences: 10,
        hits: 9,
      };

      const result = generator.generateAndSave(pattern);

      expect(result).not.toBeNull();
      expect(result?.saved).toBe(true);
      expect(existsSync(result?.path ?? '')).toBe(true);
    });

    it('should not overwrite existing template', () => {
      const generator = createThinkingTemplateGenerator({ patternsDir: tempDir });

      const pattern: IArrowPattern = {
        name: 'existing-pattern',
        deltaPattern: 'test',
        hitRate: 0.9,
        occurrences: 10,
        hits: 9,
      };

      // First save
      const result1 = generator.generateAndSave(pattern);
      expect(result1?.saved).toBe(true);

      // Second save (should not overwrite)
      const result2 = generator.generateAndSave(pattern);
      expect(result2?.saved).toBe(false);
    });
  });

  describe('generateBatch', () => {
    it('should generate multiple templates', () => {
      const generator = createThinkingTemplateGenerator({ patternsDir: tempDir });

      const patterns: IArrowPattern[] = [
        { name: 'p1', deltaPattern: '修改了 {file}', hitRate: 0.8, occurrences: 5, hits: 4 },
        { name: 'p2', deltaPattern: '新增了 {file}', hitRate: 0.9, occurrences: 5, hits: 5 },
        { name: 'p3', deltaPattern: '删除了 {file}', hitRate: 0.7, occurrences: 3, hits: 2 },
      ];

      const result = generator.generateBatch(patterns);

      expect(result.generated).toBe(3);
      expect(result.saved).toBe(3);
      expect(result.templates.length).toBe(3);
    });
  });
});
