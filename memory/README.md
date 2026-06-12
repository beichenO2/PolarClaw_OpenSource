# PolarMemory

PolarMemory is the semantic memory storage and retrieval subsystem of the Polarisor ecosystem. It compresses unstructured knowledge from KnowLever Wiki pages into high-density Blocks and provides an API for Agent consumption.

## Role in the Ecosystem

- **Depends on**: KnowLever Wiki artifacts (read-only)
- **Used by**: PolarPilot (long-term memory integration), PolarClaw (context_query memory search)

## Key Concepts

- **Block**: A 7-field compressed knowledge unit (`label`, `value`, `tokens`, `read_only`, `source_wiki`, `created_at`, `updated_at`)
- **Wiki→Block Converter**: Parses YAML frontmatter + Markdown body, compresses into dense single-line text
- **Incremental Sync**: Only converts new/changed source files, tracks sync metadata

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/blocks/search` | POST | Semantic search across Blocks |
| `/api/blocks/convert` | POST | Trigger Wiki→Block conversion |
| `/api/blocks/sync` | POST | Incremental sync with KnowLever Wiki |
| `/api/blocks/status` | GET | Service status and block count |
| `/health` | GET | Health check |

## Quick Start

```bash
# Start the service (default port 3100)
bash Start/start.sh

# Or with a custom port
POLARMEMORY_PORT=3200 bash Start/start.sh

# Other commands
bash Start/start.sh stop
bash Start/start.sh restart
bash Start/start.sh status
```

## Tech Stack

- **Runtime**: Node.js >= 18
- **Backend**: Express + TypeScript
- **Execution**: tsx (runtime), tsc (build)
- **Storage**: Filesystem JSON (`data/blocks.json`, `data/sync_meta.json`)
