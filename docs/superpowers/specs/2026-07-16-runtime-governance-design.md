# PolarClaw Runtime Governance Design

## Goal

Make PolarPort and PolarProcess the sole runtime authorities for the live
PolarClaw Web/API service while preserving port 3910, application data, the
current user-edited `PolarSkills/SOUL.md`, and all non-target services.

## Current state

- `com.polarclaw.web` launchd KeepAlive owns live PID 20539 on 3910.
- PolarProcess record `polarclaw` has adopted that PID but does not own its
  lifecycle. It has no health URL and uses legacy command `npm start`.
- PolarPort has no active PolarClaw owner because the application claims the
  mismatched identity `polarclaw-web` and silently falls back when unavailable.
- Node 20.20.2 is the verified runtime for the installed native
  `better-sqlite3` ABI. Baseline: 35 files / 313 tests, typecheck and build pass.

## Target contract

- Service ID and PolarPort owner: `polarclaw` / project `PolarClaw` / 3910.
- Foreground launcher: `Start/start.sh`; canonical command: `bash Start/start.sh`.
- Health: `GET /api/status`; final `auto_start=true`.
- The launcher validates Node 20 and native dependencies before allocation,
  checks PolarPort health, claims exactly 3910, exports `PORT` and
  `POLAR_RUNTIME_MANAGED=1`, then execs `dist/main.js`.
- `src/main.ts` rejects unmanaged startup and invalid or mismatched ports. It
  no longer claims or falls back to a port internally.

## Cutover

Registration has `prepare`, `cutover`, and `finalize` modes and never performs
lifecycle actions. After verified main and Web builds, cutover registration
changes only the canonical command. The exact launchd label is disabled and
booted out; its plist is removed only after the new governed service is
healthy. PolarProcess then starts only `polarclaw`; finalize enables health and
auto-start. The old daemon script becomes a precise PolarProcess client.

## Verification

Contract tests cover application guard, launcher, registration and forbidden
process control. Full tests/typecheck/build and Web build pass. Completion
requires one verified PID, one 3910 listener, one active PolarPort owner,
healthy `/api/status`, absent launchd job/plist, compliant audit, and R9 SSoT
evidence. No direct signal or broad service action is allowed.
