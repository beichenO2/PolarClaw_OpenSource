import express, { type Request, type Response } from "express";
import { BlockManager } from "./block_manager.js";
import type { Block, BlockSearchResult, BlockType, Conflict } from "./block.js";

const app = express();
app.use(express.json());

const blockManager = new BlockManager();

interface SearchBody {
  query: string;
  user?: string;
  topic?: string;
  top_k?: number;
  types?: BlockType[];
  temporal_valid?: boolean;
}

interface ConvertBody {
  user: string;
  topic: string;
}

interface SyncBody {
  user: string;
  topic: string;
}

app.post("/api/blocks/search", async (req: Request<object, BlockSearchResult, SearchBody>, res: Response) => {
  try {
    const { query, top_k = 10, types, temporal_valid } = req.body;
    if (!query) {
      return res.status(400).json({ error: "query is required" });
    }
    const result = await blockManager.search({ query, top_k, types, temporal_valid });
    return res.json(result);
  } catch (err) {
    console.error("[api] /api/blocks/search error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/api/blocks/convert", async (req: Request<object, { blocks: Block[]; count: number }, ConvertBody>, res: Response) => {
  try {
    const { user, topic } = req.body;
    if (!user || !topic) {
      return res.status(400).json({ error: "user and topic are required" });
    }
    const blocks = await blockManager.wikiToBlock(user, topic);
    return res.json({ blocks, count: blocks.length });
  } catch (err) {
    console.error("[api] /api/blocks/convert error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/api/blocks/sync", async (req: Request<object, { synced: number; added: number; updated: number }, SyncBody>, res: Response) => {
  try {
    const { user, topic } = req.body;
    if (!user || !topic) {
      return res.status(400).json({ error: "user and topic are required" });
    }
    const result = await blockManager.sync(user, topic);
    return res.json(result);
  } catch (err) {
    console.error("[api] /api/blocks/sync error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.get("/api/blocks/status", (_req: Request, res: Response) => {
  return res.json({
    status: "ok",
    blockCount: blockManager.getAllBlocks().length,
    timestamp: new Date().toISOString(),
  });
});

app.post("/api/blocks/upsert", (req: Request<object, { ok: boolean; block_id: string; created: boolean; conflicts?: Conflict[] }, { block: Block }>, res: Response) => {
  try {
    const { block } = req.body;
    if (!block || !block.label || !block.value) {
      return res.status(400).json({ error: "block with label and value is required" });
    }
    const result = blockManager.upsertBlock(block);
    return res.json({
      ok: true,
      block_id: result.block.label,
      created: result.created,
      conflicts: result.conflicts,
    });
  } catch (err) {
    console.error("[api] /api/blocks/upsert error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/api/blocks/delete", (req: Request<object, { ok: boolean }, { label: string }>, res: Response) => {
  try {
    const { label } = req.body;
    if (!label) {
      return res.status(400).json({ error: "label is required" });
    }
    const deleted = blockManager.deleteBlock(label);
    if (!deleted) {
      return res.json({ ok: false, error: "not found" });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[api] /api/blocks/delete error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.get("/api/blocks/:label", (req: Request<{ label: string }, { block: Block } | { error: string }>, res: Response) => {
  try {
    const { label } = req.params;
    const block = blockManager.getBlockById(label);
    if (!block) {
      return res.status(404).json({ error: "block not found" });
    }
    return res.json({ block });
  } catch (err) {
    console.error("[api] /api/blocks/:label error:", err);
    return res.status(500).json({ error: "internal error" });
  }
});

app.get("/health", (_req: Request, res: Response) => {
  return res.json({ status: "healthy" });
});

const PORT = process.env.POLARMEMORY_PORT ?? 3100;

export function startServer(): void {
  app.listen(PORT, () => {
    console.log(`[PolarMemory] API server running on port ${PORT}`);
    console.log(`[PolarMemory] Endpoints: /api/blocks/search, /api/blocks/convert, /api/blocks/sync`);
  });
}

export { app };

const isDirectRun = process.argv[1]?.endsWith("api_server.ts") || process.argv[1]?.endsWith("api_server.js");
if (isDirectRun) {
  startServer();
}