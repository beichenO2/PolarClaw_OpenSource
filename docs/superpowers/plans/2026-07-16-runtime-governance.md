# PolarClaw Runtime Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace launchd lifecycle ownership with canonical PolarProcess and PolarPort ownership on port 3910.

**Architecture:** A tested port resolver enforces the managed environment, a foreground launcher owns allocation and exec, and a registration-only script stages legacy adoption, cutover and final health. The exact launchd job is retired only after code/build readiness.

**Tech Stack:** TypeScript, Node.js 20, Bash, Vitest, PolarPort, PolarProcess, launchctl.

---

### Task 1: Enforce injected runtime port

**Files:**
- Create: `src/runtime-governance.ts`
- Create: `src/__tests__/runtime-governance.test.ts`
- Modify: `src/main.ts`

- [ ] Write tests asserting unmanaged startup, invalid `PORT`, and port mismatch throw; managed `PORT=3910` succeeds.
- [ ] Run `npx vitest run src/__tests__/runtime-governance.test.ts` and verify RED.
- [ ] Implement `resolveManagedPort(env, expected=3910)` and replace internal PolarPort claim/fallback in `main.ts`.
- [ ] Run the test and `npm run typecheck`; verify GREEN.
- [ ] Commit `feat: enforce PolarClaw runtime authority`.

### Task 2: Add launcher and staged registration

**Files:**
- Create: `Start/start.sh`
- Create: `scripts/register-runtime.sh`
- Create: `src/__tests__/runtime-files.test.ts`
- Modify: `scripts/run-web-daemon.sh`

- [ ] Write static tests for canonical claim, Node/native checks, foreground exec, three registration modes, precise client, and absence of background/PID/direct-signal behavior.
- [ ] Run the static test and verify RED.
- [ ] Implement the launcher with Node 20.20.2, pre-allocation build/native checks, PolarPort health and exact 3910 claim.
- [ ] Implement prepare=`node dist/main.js`, cutover/finalize=`bash Start/start.sh`; only finalize sets health and auto-start.
- [ ] Convert `run-web-daemon.sh` to POST only `/api/services/polarclaw/start`.
- [ ] Run static tests and `bash -n`; verify GREEN and commit `feat: govern PolarClaw service launch`.

### Task 3: Update SSoT and verify code

**Files:**
- Modify: `polaris.json`
- Modify: `PolarSoul.md`
- Modify: `README.md`
- Modify: `src/__tests__/runtime-files.test.ts`

- [ ] Add RED assertions for R9 in-progress and complete service management.
- [ ] Add R9 baseline evidence, canonical service fields, and replace launchd documentation.
- [ ] Run 313+ tests, typecheck, root build and Web build; run shell/JSON/diff checks and project audit.
- [ ] Commit `docs: define PolarClaw runtime governance` and fast-forward main without staging `PolarSkills/SOUL.md`.

### Task 4: Cut over exact live service and complete SSoT

- [ ] Build root and Web artifacts on main with Node 20; verify PID 20539 and `/api/status` remain healthy.
- [ ] Register cutover, disable and bootout only `gui/501/com.polarclaw.web`, then call only `polarclaw/start`.
- [ ] Verify one new PID/listener/owner and health; finalize registration; remove only `com.polarclaw.web.plist`.
- [ ] Mark R9 tested, run full verification, then mark done after a fresh completion gate.
- [ ] Update Agent_core inventory, commit only that file, clean the merged runtime worktree/branch, and proceed to PolarPilot.
