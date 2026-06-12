import * as fs from "node:fs";
import * as path from "node:path";
import type { Block, BlockSearchResult, Conflict, BlockSearchOptions } from "./block.js";
import { wikiDirToBlocks, resolveWikiPath } from "./wiki_converter.js";

const DATA_DIR = process.env.POLARMEMORY_DATA_DIR ?? path.resolve(__dirname, "../data");

interface SyncMeta {
  lastSynced: string;
  sourceWikiDir: string;
  blockCount: number;
}

export class BlockManager {
  private blocks: Map<string, Block> = new Map();
  private syncMeta: Map<string, SyncMeta> = new Map();
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? DATA_DIR;
    this.loadFromDisk();
  }

  async wikiToBlock(user: string, topic: string): Promise<Block[]> {
    const wikiPath = resolveWikiPath(user, topic);
    const blocks = wikiDirToBlocks(wikiPath);
    for (const block of blocks) {
      const key = `${user}/${topic}/${block.label}`;
      this.blocks.set(key, block);
    }
    this.syncMeta.set(`${user}/${topic}`, {
      lastSynced: new Date().toISOString(),
      sourceWikiDir: wikiPath,
      blockCount: blocks.length,
    });
    this.persistToDisk();
    return blocks;
  }

  async batchConvert(user: string, topics: string[]): Promise<Block[]> {
    const allBlocks: Block[] = [];
    for (const topic of topics) {
      const blocks = await this.wikiToBlock(user, topic);
      allBlocks.push(...blocks);
    }
    return allBlocks;
  }

  async search(options: BlockSearchOptions): Promise<BlockSearchResult> {
    const query = options.query ?? '';
    const topK = options.top_k ?? 10;
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(Boolean);

    let candidates = Array.from(this.blocks.values());

    // Filter by types if provided
    if (options.types && options.types.length > 0) {
      candidates = candidates.filter((block) => block.type && options.types!.includes(block.type));
    }

    const now = new Date();
    const scored = candidates.map((block) => {
      let score = 0;
      const labelLower = block.label.toLowerCase();
      const valueLower = block.value.toLowerCase();

      for (const term of queryTerms) {
        if (labelLower.includes(term)) score += 10;
        if (valueLower.includes(term)) score += 5;
      }

      if (block.read_only) score += 2;

      // Compute temporalValid if temporal_valid option is true
      let temporalValid: boolean | undefined;
      if (options.temporal_valid && block.temporal) {
        temporalValid = true;
        if (block.temporal.valid_from) {
          temporalValid = temporalValid && now >= new Date(block.temporal.valid_from);
        }
        if (block.temporal.valid_until) {
          temporalValid = temporalValid && now <= new Date(block.temporal.valid_until);
        }
      }

      return { block, score, temporalValid };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK).map((s) => {
      const b = { ...s.block };
      if (s.temporalValid !== undefined) {
        (b as any).temporalValid = s.temporalValid;
      }
      return b;
    });

    return {
      blocks: top,
      total: this.blocks.size,
      query,
    };
  }

  async rankByImportance(query: string, topK = 10): Promise<BlockSearchResult> {
    return this.search({ query, top_k: topK });
  }

  async sync(user: string, topic: string): Promise<{ synced: number; added: number; updated: number }> {
    const wikiPath = resolveWikiPath(user, topic);
    const newBlocks = wikiDirToBlocks(wikiPath);
    let added = 0;
    let updated = 0;

    for (const block of newBlocks) {
      const key = `${user}/${topic}/${block.label}`;
      const existing = this.blocks.get(key);
      if (!existing) {
        added++;
      } else if (existing.updated_at !== block.updated_at || existing.value !== block.value) {
        updated++;
      }
      this.blocks.set(key, block);
    }

    this.syncMeta.set(`${user}/${topic}`, {
      lastSynced: new Date().toISOString(),
      sourceWikiDir: wikiPath,
      blockCount: newBlocks.length,
    });

    this.persistToDisk();
    return { synced: newBlocks.length, added, updated };
  }

  getBlock(user: string, topic: string, label: string): Block | undefined {
    return this.blocks.get(`${user}/${topic}/${label}`);
  }

  getAllBlocks(): Block[] {
    return Array.from(this.blocks.values());
  }

  getBlockById(label: string): Block | undefined {
    for (const [key, block] of this.blocks) {
      if (key.endsWith(`/${label}`) || block.label === label) {
        return block;
      }
    }
    return undefined;
  }

  detectConflicts(_query: string, newBlock: Block): Conflict[] {
    const conflicts: Conflict[] = [];
    const newValue = newBlock.value.toLowerCase();

    const positiveWords = ['like', 'love', 'enjoy', 'prefer', 'yes', 'good', 'great', 'happy', 'support', 'agree', 'want', 'positive', 'approve'];
    const negativeWords = ['dislike', 'hate', 'avoid', 'no', 'bad', 'terrible', 'sad', 'oppose', 'disagree', 'refuse', 'negative', 'reject'];

    for (const [key, existingBlock] of this.blocks) {
      if (key.endsWith(`/${newBlock.label}`)) continue;
      if (newBlock.type && existingBlock.type && newBlock.type !== existingBlock.type) continue;

      const similarity = this.trigramJaccard(existingBlock.value, newBlock.value);

      if (similarity > 0.5) {
        const existingValue = existingBlock.value.toLowerCase();
        const hasExistingPositive = positiveWords.some((w) => existingValue.includes(w));
        const hasNewNegative = negativeWords.some((w) => newValue.includes(w));
        const hasExistingNegative = negativeWords.some((w) => existingValue.includes(w));
        const hasNewPositive = positiveWords.some((w) => newValue.includes(w));

        if ((hasExistingPositive && hasNewNegative) || (hasExistingNegative && hasNewPositive)) {
          conflicts.push({
            blockA: existingBlock.label,
            blockB: newBlock.label,
            conflict_type: 'contradiction',
            confidence: similarity,
          });
        } else if (existingBlock.temporal?.valid_until) {
          const validUntil = new Date(existingBlock.temporal.valid_until);
          if (validUntil < new Date()) {
            conflicts.push({
              blockA: existingBlock.label,
              blockB: newBlock.label,
              conflict_type: 'staleness',
              confidence: similarity,
            });
          }
        } else if (similarity < 0.8) {
          conflicts.push({
            blockA: existingBlock.label,
            blockB: newBlock.label,
            conflict_type: 'ambiguity',
            confidence: similarity,
          });
        }
      }
    }

    return conflicts;
  }

  private trigramJaccard(a: string, b: string): number {
    const getTrigrams = (s: string): Set<string> => {
      const trigrams = new Set<string>();
      for (let i = 0; i <= s.length - 3; i++) {
        trigrams.add(s.substring(i, i + 3));
      }
      return trigrams;
    };

    const trigramsA = getTrigrams(a);
    const trigramsB = getTrigrams(b);

    if (trigramsA.size === 0 && trigramsB.size === 0) return 1;
    if (trigramsA.size === 0 || trigramsB.size === 0) return 0;

    const intersection = new Set([...trigramsA].filter((t) => trigramsB.has(t)));
    const union = new Set([...trigramsA, ...trigramsB]);
    return intersection.size / union.size;
  }

  upsertBlock(block: Block): { created: boolean; block: Block; conflicts?: Conflict[] } {
    const now = new Date().toISOString();
    const existing = this.getBlockById(block.label);
    let created: boolean;

    if (existing) {
      block.created_at = existing.created_at;
      block.updated_at = now;
      created = false;
    } else {
      block.created_at = now;
      block.updated_at = now;
      created = true;
    }

    this.blocks.set(block.label, block);
    this.persistToDisk();

    const conflicts = this.detectConflicts('', block);

    return { created, block, conflicts: conflicts.length > 0 ? conflicts : undefined };
  }

  deleteBlock(label: string): boolean {
    const existing = this.getBlockById(label);
    if (!existing) return false;
    // Find the key in the map
    for (const [key, block] of this.blocks) {
      if (block === existing) {
        this.blocks.delete(key);
        break;
      }
    }
    this.persistToDisk();
    return true;
  }

  getSyncMeta(user: string, topic: string): SyncMeta | undefined {
    return this.syncMeta.get(`${user}/${topic}`);
  }

  private loadFromDisk(): void {
    const blocksFile = path.join(this.dataDir, "blocks.json");
    const metaFile = path.join(this.dataDir, "sync_meta.json");

    if (fs.existsSync(blocksFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(blocksFile, "utf-8")) as Array<[string, Block]>;
        for (const [key, block] of data) {
          // Set defaults for new fields on existing blocks
          if (!block.type) block.type = 'fact';
          if (!block.source) block.source = 'wiki';
          if (block.confidence === undefined) block.confidence = 0.9;
          this.blocks.set(key, block);
        }
      } catch {
        this.blocks = new Map();
      }
    }

    if (fs.existsSync(metaFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(metaFile, "utf-8")) as Array<[string, SyncMeta]>;
        this.syncMeta = new Map(data);
      } catch {
        this.syncMeta = new Map();
      }
    }
  }

  private persistToDisk(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(this.dataDir, "blocks.json"),
      JSON.stringify(Array.from(this.blocks.entries()), null, 2),
    );
    fs.writeFileSync(
      path.join(this.dataDir, "sync_meta.json"),
      JSON.stringify(Array.from(this.syncMeta.entries()), null, 2),
    );
  }
}
