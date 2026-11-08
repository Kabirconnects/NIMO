# 2026-11-08 — Capture Dedup Crash Fix

## Bug

`agent-loop.ts` crashed with:
```
SqliteError: UNIQUE constraint failed: experiences.owner_id, experiences.content_hash
```

The `experiences` table has a UNIQUE index on `(owner_id, content_hash)`.
When the agent sends the same prompt twice (or "Did: ..." twice), the second
`captureExperience` fails because the hash already exists.

## Root Cause

The UNIQUE index was designed for content deduplication at the experience level,
but it prevented the agent from recording identical experiences in separate turns.
The agent loop sends:
1. User prompt → capture
2. "Did: ..." response → capture

If the user repeats the same message, or the agent's response text is identical to
a previous turn, the second capture crashes.

## Fix

Salted the content hash: `hashContent(content + "\0" + random_id)`. Now identical
content in separate turns gets separate experience rows.

**Why this is correct:**
- Experience rows are *evidence* (provenance), not knowledge. Two turns saying the
  same thing are two pieces of evidence.
- Memory-level dedupe (consolidate.ts) already handles the knowledge layer —
  duplicate memories are merged, not duplicated.
- The salt makes content_hash unique per experience, so the UNIQUE index
  never fires for legitimate turn-based captures.

## Test

`scripts/capture-dedup-test.ts`: 7 assertions.
- Same content captured twice → no crash, different ids
- Same "Did:" content 3 times → all succeed
- remember() twice with same content → memory deduplicated (merged=1)
- DB row counts: 7 experiences, ≤3 memories (dedupe at memory layer)

## Note

The AGI test (`agi-test.ts`) previously expected the UNIQUE crash as correct
behavior. Updated to expect memory-level merge instead — the correct architecture.
