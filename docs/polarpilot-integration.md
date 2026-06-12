# PolarPilot Integration Guide

## Overview

PolarClaw's SDK modules are **thin HTTP adapters** that call PolarPilot's contract endpoints. PolarClaw never directly accesses pilot stores, target files, or approval databases.

## Architecture

```
┌─────────────────────────────────────────────┐
│              PolarClaw (Interactive Hub)     │
│                                             │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐ │
│  │ Feishu   │  │  CLI      │  │  Web     │ │
│  │ Adapter  │  │  Adapter  │  │  Server  │ │
│  └────┬─────┘  └─────┬─────┘  └────┬─────┘ │
│       └───────────────┼─────────────┘       │
│                       ▼                     │
│              ┌────────────────┐             │
│              │   ReAct Agent  │             │
│              └────────┬───────┘             │
│                       ▼                     │
│         ┌─────────────────────────┐         │
│         │  SDK (thin adapters)    │         │
│         │  lobsters│targets│events│         │
│         │  approvals│users        │         │
│         └────────────┬────────────┘         │
│                      │                      │
│         ┌────────────▼────────────┐         │
│         │   PolarPilotClient      │         │
│         │   (HTTP contract)       │         │
│         └────────────┬────────────┘         │
└──────────────────────┼──────────────────────┘
                       │ HTTP
                       ▼
┌──────────────────────────────────────────────┐
│         PolarPilot (Autonomous Guardian)     │
│                                              │
│  ┌──────────────┐  ┌───────────────────────┐ │
│  │ State Machine│  │ Target Tree (fs)      │ │
│  │ Runtime      │  │ Approvals (SQLite)    │ │
│  │ Daemon       │  │ Events (SOTAgent+file)│ │
│  └──────────────┘  └───────────────────────┘ │
└──────────────────────────────────────────────┘
```

## Configuration

Set `POLARPILOT_URL` in `.env` or environment:

```bash
POLARPILOT_URL=http://127.0.0.1:4900
```

Default: `http://127.0.0.1:4900`

## SDK Usage

```typescript
import { createPolarClawSDK } from './sdk/index.js';

const sdk = createPolarClawSDK({
  userRegistry,
  polarpilotUrl: process.env.POLARPILOT_URL || 'http://127.0.0.1:4900',
});

// All pilot operations are async HTTP calls
const status = await sdk.lobsters.status('knowlever');
const targets = await sdk.targets.list('KnowLever');
const result = await sdk.events.emit(event);
const approval = await sdk.approvals.request({ ... });
```

## Contract Schemas

Contract schemas live in `contracts/`:

| File | Covers |
|------|--------|
| `polarpilot-status.schema.json` | Status and health queries |
| `polarpilot-targets.schema.json` | Target CRUD operations |
| `polarpilot-events.schema.json` | Event emit and query |
| `polarpilot-approvals.schema.json` | Approval lifecycle |

TypeScript contract types are in `src/contracts/polarpilot-query.ts`.

## Error Handling

When PolarPilot is unreachable, SDK methods throw `PolarPilotError`:

```typescript
import { PolarPilotError } from './contracts/polarpilot-client.js';

try {
  await sdk.lobsters.status('knowlever');
} catch (err) {
  if (err instanceof PolarPilotError) {
    console.error(`PolarPilot error (${err.statusCode}): ${err.message}`);
  }
}
```

Web API routes return HTTP 502 when PolarPilot is unreachable.
