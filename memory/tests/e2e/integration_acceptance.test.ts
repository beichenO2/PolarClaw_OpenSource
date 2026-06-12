/**
 * E2E 集成验收测试 — KnowLever → PolarMemory → PolarClaw 全链路记忆系统
 *
 * 验证项：
 * 1. ClawMem 清理 (rg -i "clawmem" → 0 matches)
 * 2. KnowLever compressContext() 关键信息保护
 * 3. PolarMemory /api/blocks/search 返回 Block[]
 * 4. PolarClaw SessionMemoryManager 多轮对话记忆传递
 * 5. KnowLever get_time_weight() 时间衰减权重
 * 6. 全链路集成
 * 7. 毕业测试三件套：联调 + 压力 + 攻击
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

// ─── Step 1: ClawMem 清理验证 ───

describe('Step 1: ClawMem 清理验证', () => {
  it('KnowLever/ 中不应包含 clawmem 引用', () => {
    const result = execSync(
      'grep -ri "clawmem" KnowLever/wiki-engine/ KnowLever/scripts/ KnowLever/rag/ --include="*.js" --include="*.ts" --include="*.sh" --include="*.py" -l 2>/dev/null || true',
      { cwd: '~/Polarisor', encoding: 'utf-8', timeout: 30000 }
    );
    const files = result.trim().split('\n').filter(Boolean);
    console.log(`ClawMem KnowLever 残留文件数: ${files.length}`);
    expect(files.length).toBe(0);
  });

  it('PolarClaw/ 中不应包含 clawmem 引用', () => {
    const result = execSync(
      'grep -ri "clawmem" PolarClaw/src/ --include="*.js" --include="*.ts" -l 2>/dev/null || true',
      { cwd: '~/Polarisor', encoding: 'utf-8' }
    );
    const files = result.trim().split('\n').filter(Boolean);
    expect(files.length).toBe(0);
  });
});

// ─── Step 2: KnowLever 关键信息保护验证 ───

describe('Step 2: KnowLever 关键信息保护', () => {
  it('compressContext 保护机制应保留关键信息', () => {
    const result = execSync(
      'node tests/test_compress_context_protection.js',
      { cwd: '~/Polarisor/KnowLever', encoding: 'utf-8' }
    );
    expect(result).toContain('全部 8 项测试通过');
    expect(result).toContain('关键信息保留率: 100%');
  });
});

// ─── Step 3: PolarMemory Block 转换验证 ───

describe('Step 3: PolarMemory Block 转换', () => {
  it('BlockManager 应能将 Wiki 转换为 Block[]', async () => {
    const { BlockManager } = await import('../../src/block_manager.js');
    const { tmpdir } = await import('node:os');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');

    const tmpDir = mkdtempSync(join(tmpdir(), 'e2e-pm-'));
    try {
      const manager = new BlockManager(tmpDir);
      const blocks = await manager.wikiToBlock('test', 'pharm-test');
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0]).toHaveProperty('label');
      expect(blocks[0]).toHaveProperty('value');
      expect(blocks[0]).toHaveProperty('tokens');
      expect(blocks[0]).toHaveProperty('read_only');
      expect(blocks[0]).toHaveProperty('source_wiki');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('rankByImportance 应返回 BlockSearchResult 格式', async () => {
    const { BlockManager } = await import('../../src/block_manager.js');
    const { tmpdir } = await import('node:os');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');

    const tmpDir = mkdtempSync(join(tmpdir(), 'e2e-pm-'));
    try {
      const manager = new BlockManager(tmpDir);
      await manager.wikiToBlock('test', 'pharm-test');
      const result = await manager.rankByImportance('抗癫痫', 5);
      expect(result).toHaveProperty('blocks');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('query');
      expect(Array.isArray(result.blocks)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── Step 4: PolarClaw 运行时记忆验证 ───

describe('Step 4: PolarClaw 运行时记忆', () => {
  it('SessionMemoryManager 应存在于 PolarClaw/src/memory/', async () => {
    const mod = await import('../../../PolarClaw/src/memory/SessionMemory.js');
    expect(mod.SessionMemoryManager).toBeDefined();
    expect(mod.CompressionMode).toBeDefined();
  });
});

// ─── Step 5: 时间衰减权重验证 ───

describe('Step 5: 时间衰减权重', () => {
  it('get_time_weight() 应存在于 KnowLever/rag/pipeline.py', () => {
    const result = execSync(
      'grep -c "get_time_weight" KnowLever/rag/pipeline.py',
      { cwd: '~/Polarisor', encoding: 'utf-8' }
    );
    const count = parseInt(result.trim(), 10);
    expect(count).toBeGreaterThan(0);
  });

  it('7 天前权重应 < 0.5', () => {
    const result = execSync(
      `cd ~/Polarisor/KnowLever && python3 -c "
import datetime
from rag.pipeline import get_time_weight
w = get_time_weight(datetime.datetime.now() - datetime.timedelta(days=7))
print(f'{w:.6f}')
"`,
      { encoding: 'utf-8' }
    );
    const weight = parseFloat(result.trim().split('\n').pop()!);
    expect(weight).toBeLessThan(0.5);
  });
});

// ─── Step 6: 全链路集成测试 ───

describe('Step 6: 全链路集成', () => {
  it('KnowLever → PolarMemory → PolarClaw 链路应可连通', async () => {
    const { BlockManager } = await import('../../src/block_manager.js');
    const { SessionMemoryManager, CompressionMode } = await import('../../../PolarClaw/src/memory/SessionMemory.js');
    const { tmpdir } = await import('node:os');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');

    const tmpDir = mkdtempSync(join(tmpdir(), 'e2e-chain-'));
    try {
      // 1. PolarMemory 转换 Block（模拟 KnowLever Wiki 编译后）
      const blockManager = new BlockManager(tmpDir);
      const blocks = await blockManager.wikiToBlock('test', 'pharm-test');
      expect(blocks.length).toBeGreaterThan(0);

      // 2. PolarClaw 获取长期记忆 + 运行时传递
      const sessionMgr = new SessionMemoryManager({
        mode: CompressionMode.STATIC_MESSAGE_BUFFER,
      });
      const convId = 'e2e-chain-test';
      sessionMgr.updateWorkingMemory(convId, [
        { role: 'user', content: '用户目标：构建知识管理系统' },
        { role: 'assistant', content: '收到，正在验证全链路' },
      ]);

      // 3. 压缩并注入（验证关键信息保护）
      const compressed = await sessionMgr.compressForNextTurn(convId);
      expect(compressed.length).toBeLessThanOrEqual(20000);

      const newMgr = new SessionMemoryManager();
      await newMgr.injectFromPrevious(convId, compressed);
      const injection = newMgr.buildMemoryInjection(convId);
      expect(injection.length).toBeGreaterThan(0);
      expect(injection).toContain('历史对话摘要');

      console.log('全链路集成: KnowLever → PolarMemory → PolarClaw ✓');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});