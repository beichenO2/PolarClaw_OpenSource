import * as fs from "node:fs";
import * as path from "node:path";
import type { Block, WikiFrontmatter } from "./block.js";
import type { BlockType } from "./block.js";

const KNOWLEVER_DATA_ROOT = process.env.KNOWLEVER_DATA_ROOT ?? "../KnowLever/data";

function parseFrontmatter(content: string): { frontmatter: WikiFrontmatter; body: string } {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content };
  }
  const raw = fmMatch[1];
  const body = fmMatch[2];
  const frontmatter: WikiFrontmatter = {};
  for (const line of raw.split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value: unknown = kv[2].trim();
    // Strip surrounding quotes from string values
    if (typeof value === "string" && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if ((value as string).startsWith("[") && (value as string).endsWith("]")) {
      try {
        value = JSON.parse(value as string);
      } catch {
        // keep as string
      }
    } else if (value === "null") {
      value = null;
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (/^\d+(\.\d+)?$/.test(value as string)) {
      value = Number(value);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compressBody(body: string, frontmatter: WikiFrontmatter): string {
  const parts: string[] = [];
  if (frontmatter.title) {
    parts.push(frontmatter.title);
  }
  if (frontmatter.summary) {
    parts.push(frontmatter.summary);
  }
  const lines = body.split("\n").filter((l) => l.trim().length > 0 && !l.startsWith("#"));
  if (lines.length > 0) {
    parts.push(lines.join(" ").replace(/\s+/g, " ").trim());
  }
  return parts.join(" | ");
}

export function wikiFileToBlock(wikiFilePath: string, baseDir: string): Block {
  const content = fs.readFileSync(wikiFilePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(content);
  const compressedValue = compressBody(body, frontmatter);
  const stat = fs.statSync(wikiFilePath);
  const fileTime = stat.mtime.toISOString();
  const relativePath = path.relative(baseDir, wikiFilePath);

  const isReadOnly = frontmatter.status === "done" || (frontmatter.confidence !== undefined && frontmatter.confidence >= 0.9);

  // Map frontmatter type to BlockType
  const typeMap: Record<string, Block['type']> = {
    entity: 'entity',
    preference: 'preference',
    fact: 'fact',
    goal: 'goal',
    relationship: 'relationship',
    event: 'event',
    concept: 'concept',
    procedure: 'procedure',
    emotion: 'emotion',
    decision: 'decision',
    skill: 'skill',
    context: 'context',
    meta: 'meta',
  };
  const blockType = frontmatter.type ? (typeMap[frontmatter.type] ?? 'fact' as const) : 'fact';

  return {
    label: frontmatter.id ?? path.basename(wikiFilePath, ".md"),
    value: compressedValue,
    tokens: estimateTokens(compressedValue),
    read_only: isReadOnly,
    source_wiki: relativePath,
    created_at: frontmatter.created ?? fileTime,
    updated_at: frontmatter.updated ?? fileTime,
    type: blockType,
    source: 'wiki',
    confidence: frontmatter.confidence ?? 0.9,
    entity_refs: frontmatter.tags,
  };
}

export function wikiDirToBlocks(wikiDir: string): Block[] {
  const blocks: Block[] = [];
  if (!fs.existsSync(wikiDir)) {
    return blocks;
  }
  const entries = fs.readdirSync(wikiDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(wikiDir, entry.name);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      blocks.push(...wikiDirToBlocks(fullPath));
    } else if (entry.name.endsWith(".md")) {
      try {
        blocks.push(wikiFileToBlock(fullPath, wikiDir));
      } catch (err) {
        console.error(`[wiki_converter] Failed to convert ${fullPath}:`, err);
      }
    }
  }
  return blocks;
}

export function resolveWikiPath(user: string, topic: string): string {
  return path.resolve(KNOWLEVER_DATA_ROOT, "users", user, "topics", topic, "wiki");
}

export { KNOWLEVER_DATA_ROOT };
