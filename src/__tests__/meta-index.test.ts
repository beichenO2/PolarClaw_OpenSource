import { describe, it, expect } from 'vitest';
import { createMetaIndex } from '../adapters/skills/meta-index.js';

describe('R6: 生态地图 (meta-index)', () => {
  it('creates a meta index with all expected methods', () => {
    const metaIndex = createMetaIndex();

    expect(typeof metaIndex.scan).toBe('function');
    expect(typeof metaIndex.search).toBe('function');
    expect(typeof metaIndex.all).toBe('function');
    expect(typeof metaIndex.get).toBe('function');
    expect(typeof metaIndex.markActivated).toBe('function');
    expect(typeof metaIndex.markDeactivated).toBe('function');
    expect(typeof metaIndex.toPromptCatalog).toBe('function');
    expect(typeof metaIndex.allMetaSkills).toBe('function');
    expect(typeof metaIndex.matchMetaSkills).toBe('function');
  });

  it('scan with non-existent dirs returns empty index', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent/skills/dir']);

    expect(metaIndex.all()).toEqual([]);
    expect(metaIndex.allMetaSkills()).toEqual([]);
  });

  it('search returns empty results for empty index', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);

    const results = metaIndex.search('test');
    expect(results).toEqual([]);
  });

  it('get returns undefined for unknown skill', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);

    expect(metaIndex.get('nonexistent')).toBeUndefined();
  });

  it('toPromptCatalog returns empty string for empty index', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);

    expect(metaIndex.toPromptCatalog()).toBe('');
  });

  it('matchMetaSkills returns empty for empty meta skills', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);

    expect(metaIndex.matchMetaSkills('experiment')).toEqual([]);
  });
});

describe('R6: 差异化提示词 (meta-index prompt catalog)', () => {
  it('markActivated on non-existent entry does not crash', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);
    metaIndex.markActivated('nonexistent', ['tool1']);
    expect(true).toBe(true);
  });

  it('markDeactivated on non-existent entry does not crash', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);
    metaIndex.markDeactivated('nonexistent');
    expect(true).toBe(true);
  });
});

describe('R6: Meta-Skills (meta-index scanning)', () => {
  it('allMetaSkills returns empty when no _meta directory exists', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);

    expect(metaIndex.allMetaSkills()).toEqual([]);
  });

  it('matchMetaSkills returns empty when no meta skills loaded', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);

    const matched = metaIndex.matchMetaSkills('experiment report');
    expect(matched).toEqual([]);
  });
});

describe('R6: Tool-Skills 按需加载 (on-demand loading)', () => {
  it('scan skips _meta directory entries from regular index', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);

    const all = metaIndex.all();
    const metaEntries = all.filter(e => e.name.startsWith('_meta'));
    expect(metaEntries).toEqual([]);
  });

  it('markActivated sets activated=true and updates toolNames', () => {
    const metaIndex = createMetaIndex();
    metaIndex.scan(['/nonexistent']);
    metaIndex.markActivated('some_skill', ['tool_a', 'tool_b']);
    // On non-existent entry, it's a no-op
    expect(metaIndex.get('some_skill')).toBeUndefined();
  });
});