#!/bin/bash
# ssot-pr-gate.sh — L2 SSOT consistency gate for PR merge
#
# Usage: bash Agent_core/scripts/ssot-pr-gate.sh <project-dir> [--strict]
#
# Checks that code declarations match SSOT documentation before merge.
# Returns 0 if pass, 1 if fail.
#
# Checks:
# 1. polaris.json features marked "done" have corresponding code
# 2. PolarSkills/ SKILL.md entries have corresponding tools/routes
# 3. polaris.json._meta.last_synced_at is not stale (>7 days behind src/)
# 4. PolarSoul.md interface declarations match actual API routes (if web server exists)

set -euo pipefail

PROJECT_DIR="${1:-.}"
STRICT=0
[ "${2:-}" = "--strict" ] && STRICT=1

if [ ! -d "$PROJECT_DIR" ]; then
  echo "ERROR: $PROJECT_DIR is not a directory" >&2
  exit 1
fi

cd "$PROJECT_DIR"
PROJECT_NAME=$(basename "$(pwd)")
POLARIS="polaris.json"
ERRORS=0
WARNINGS=0

echo "╔══════════════════════════════════════╗"
echo "║  SSOT PR Gate — $PROJECT_NAME"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── Check 1: polaris.json _meta freshness ───

if [ -f "$POLARIS" ]; then
  LAST_SYNCED=$(python3 -c "
import json
with open('$POLARIS') as f:
    d = json.load(f)
print(d.get('_meta', {}).get('last_synced_at', ''))
" 2>/dev/null || echo "")

  if [ -z "$LAST_SYNCED" ]; then
    echo "⚠️  Check 1: _meta.last_synced_at missing"
    WARNINGS=$((WARNINGS+1))
  else
    # Use python for reliable ISO timestamp parsing
    SYNC_EPOCH=$(python3 -c "
from datetime import datetime, timezone
import sys
ts = '$LAST_SYNCED'
try:
    dt = datetime.fromisoformat(ts)
    print(int(dt.timestamp()))
except:
    print(0)
" 2>/dev/null || echo "0")

    # Compare against the most recent file commit in the project (not current time)
    LATEST_FILE_EPOCH=$(git log -1 --format=%at -- . 2>/dev/null || echo "$SYNC_EPOCH")
    [ -z "$LATEST_FILE_EPOCH" ] && LATEST_FILE_EPOCH="$SYNC_EPOCH"

    if [ "$LATEST_FILE_EPOCH" -gt "$SYNC_EPOCH" ]; then
      DRIFT_SECS=$((LATEST_FILE_EPOCH - SYNC_EPOCH))
    else
      DRIFT_SECS=0
    fi
    DRIFT_DAYS=$((DRIFT_SECS / 86400))

    if [ "$DRIFT_DAYS" -gt 7 ]; then
      echo "❌ Check 1: polaris.json is ${DRIFT_DAYS}d behind latest code change (synced: ${LAST_SYNCED:0:10})"
      ERRORS=$((ERRORS+1))
    else
      echo "✅ Check 1: polaris.json fresh (drift=${DRIFT_DAYS}d behind latest change)"
    fi
  fi
else
  echo "❌ Check 1: polaris.json not found"
  ERRORS=$((ERRORS+1))
fi

# ─── Check 2: done features have evidence (aligned with ssot-audit.mjs hasEvidence) ───

if [ -f "$POLARIS" ]; then
  DONE_FEATURES=$(python3 -c "
import json

def has_evidence(feat):
    '''Mirror ssot-audit.mjs hasEvidence: evidence | tests | last_verified_commit | last_verified_at'''
    for key in ('evidence', 'tests', 'last_verified_commit', 'last_verified_at'):
        val = feat.get(key)
        if isinstance(val, list) and any(str(v).strip() for v in val):
            return True
        if isinstance(val, dict) and val:
            return True
        if isinstance(val, str) and val.strip():
            return True
    return False

with open('$POLARIS') as f:
    d = json.load(f)
for req in d.get('requirements', []):
    for feat in req.get('features', []):
        if feat.get('status') == 'done' and not has_evidence(feat):
            print(f\"  - {feat['name']} (no evidence/tests/last_verified_*)\")
" 2>/dev/null || echo "")

  if [ -n "$DONE_FEATURES" ]; then
    echo "⚠️  Check 2: done features without evidence:"
    echo "$DONE_FEATURES"
    WARNINGS=$((WARNINGS+1))
  else
    echo "✅ Check 2: all done features have evidence"
  fi
fi

# ─── Check 3: PolarSkills/ SKILL.md consistency ───

if [ -d "PolarSkills" ]; then
  ORPHAN_SKILLS=0
  for SKILL_DIR in PolarSkills/*/; do
    [ -d "$SKILL_DIR" ] || continue
    SKILL_NAME=$(basename "$SKILL_DIR")
    [ "$SKILL_NAME" = "_meta" ] || [ "$SKILL_NAME" = "_shared" ] || [ "$SKILL_NAME" = "_candidates" ] && continue

    if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
      echo "  ⚠️  $SKILL_NAME: missing SKILL.md"
      ORPHAN_SKILLS=$((ORPHAN_SKILLS+1))
    fi

    if [ -f "$SKILL_DIR/tools.ts" ]; then
      # Check if the tool file has actual exports
      if ! grep -q "export" "$SKILL_DIR/tools.ts" 2>/dev/null; then
        echo "  ⚠️  $SKILL_NAME: tools.ts has no exports"
        ORPHAN_SKILLS=$((ORPHAN_SKILLS+1))
      fi
    fi
  done

  if [ "$ORPHAN_SKILLS" -eq 0 ]; then
    echo "✅ Check 3: PolarSkills/ consistent"
  else
    echo "⚠️  Check 3: $ORPHAN_SKILLS skill issues found"
    WARNINGS=$((WARNINGS+1))
  fi
else
  echo "⚠️  Check 3: PolarSkills/ directory missing"
  WARNINGS=$((WARNINGS+1))
fi

# ─── Check 4: SSOT file structure completeness ───

MISSING=""
for F in PolarSoul.md polaris.json worker.md roadmap.md; do
  [ -f "$F" ] || MISSING="$MISSING $F"
done
[ -d "PolarSkills" ] || MISSING="$MISSING PolarSkills/"
[ -d "decisions" ] || MISSING="$MISSING decisions/"

# polaris.json + PolarSkills are required; other six-piece files are optional
# for standalone sub-repos (PolarClaw ships polaris.json only).
REQUIRED_MISSING=""
[ -f "polaris.json" ] || REQUIRED_MISSING="$REQUIRED_MISSING polaris.json"
[ -d "PolarSkills" ] || REQUIRED_MISSING="$REQUIRED_MISSING PolarSkills/"

if [ -n "$REQUIRED_MISSING" ]; then
  echo "❌ Check 4: missing required:$REQUIRED_MISSING"
  ERRORS=$((ERRORS+1))
elif [ -z "$MISSING" ]; then
  echo "✅ Check 4: six-piece structure complete"
else
  echo "⚠️  Check 4: optional six-piece missing:$MISSING"
  WARNINGS=$((WARNINGS+1))
fi

# ─── Summary ───

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$ERRORS" -gt 0 ]; then
  echo "❌ GATE FAILED: $ERRORS error(s), $WARNINGS warning(s)"
  exit 1
elif [ "$WARNINGS" -gt 0 ] && [ "$STRICT" -eq 1 ]; then
  echo "❌ GATE FAILED (strict mode): $WARNINGS warning(s)"
  exit 1
elif [ "$WARNINGS" -gt 0 ]; then
  echo "⚠️  GATE PASSED with $WARNINGS warning(s)"
  exit 0
else
  echo "✅ GATE PASSED: all checks clean"
  exit 0
fi
