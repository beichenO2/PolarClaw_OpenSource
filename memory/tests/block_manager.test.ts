import { BlockManager } from "../src/block_manager.js";
import { wikiFileToBlock, wikiDirToBlocks, resolveWikiPath } from "../src/wiki_converter.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    testsFailed++;
    console.error(`  FAIL: ${message}`);
  } else {
    testsPassed++;
    console.log(`  PASS: ${message}`);
  }
}

async function testWikiConverter(): Promise<void> {
  console.log("\n=== wiki_converter tests ===");

  const wikiPath = resolveWikiPath("test", "pharm-test");
  console.log(`  Wiki path: ${wikiPath}`);

  assert(fs.existsSync(wikiPath), `Wiki directory exists at ${wikiPath}`);

  const blocks = wikiDirToBlocks(wikiPath);
  assert(blocks.length > 0, `wikiDirToBlocks returns blocks (got ${blocks.length})`);

  for (const block of blocks.slice(0, 3)) {
    assert(typeof block.label === "string" && block.label.length > 0, `Block label is non-empty string: "${block.label}"`);
    assert(typeof block.value === "string", `Block value is string`);
    assert(typeof block.tokens === "number" && block.tokens > 0, `Block tokens is positive number: ${block.tokens}`);
    assert(typeof block.read_only === "boolean", `Block read_only is boolean`);
    assert(typeof block.source_wiki === "string" && block.source_wiki.length > 0, `Block source_wiki is non-empty string`);
    assert(typeof block.created_at === "string", `Block created_at is string`);
    assert(typeof block.updated_at === "string", `Block updated_at is string`);
  }

  const conceptFile = path.join(wikiPath, "concepts", "concept-antiepileptic-classification.md");
  if (fs.existsSync(conceptFile)) {
    const block = wikiFileToBlock(conceptFile, wikiPath);
    assert(block.label === "concept-antiepileptic-classification", `Frontmatter id parsed correctly: "${block.label}"`);
    assert(block.value.includes("抗癫痫药"), `Compressed value contains key content`);
  }
}

async function testBlockManager(): Promise<void> {
  console.log("\n=== block_manager tests ===");

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polarmemory-test-"));

  try {
    const manager = new BlockManager(tmpDir);

    const blocks = await manager.wikiToBlock("test", "pharm-test");
    assert(blocks.length > 0, `wikiToBlock returns blocks (got ${blocks.length})`);

    const allBlocks = manager.getAllBlocks();
    assert(allBlocks.length === blocks.length, `getAllBlocks matches wikiToBlock count`);

    const result = await manager.rankByImportance("抗癫痫", 5);
    assert(result.blocks.length > 0, `rankByImportance returns results`);
    assert(result.total === allBlocks.length, `rankByImportance total matches block count`);
    assert(result.query === "抗癫痫", `rankByImportance preserves query`);

    const syncResult = await manager.sync("test", "pharm-test");
    assert(syncResult.synced === blocks.length, `sync synced count matches`);
    assert(syncResult.added === 0, `sync second time: no new additions (all already loaded by wikiToBlock)`);
    assert(syncResult.updated === 0, `sync second time: no updates (wiki unchanged)`);

    assert(fs.existsSync(path.join(tmpDir, "blocks.json")), `blocks.json persisted`);
    assert(fs.existsSync(path.join(tmpDir, "sync_meta.json")), `sync_meta.json persisted`);

    const manager2 = new BlockManager(tmpDir);
    assert(manager2.getAllBlocks().length === allBlocks.length, `Reload from disk preserves block count`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  console.log("PolarMemory Block Manager Tests");
  console.log("================================");

  await testWikiConverter();
  await testBlockManager();

  console.log("\n================================");
  console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
