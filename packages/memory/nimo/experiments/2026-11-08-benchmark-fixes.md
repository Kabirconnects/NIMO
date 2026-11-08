# 2026-11-08 — Tandem Fix for Benchmark Failures (95% vs 82%)

## The three gaps and the tandem fix

The universal benchmark reported 82%. The failures clustered in three
structural problems. This fix addresses all three without breaking any
of the other suites.

### 1. Denial leak (memory 60% → 100%)

**Cause:** Agent denials ("I do not have...") were extracted as ephemeral
`observation` memories and stored. On a name query, the denial node
surfaced in top-K alongside the real name, and the agent recited it back
as knowledge — the benchmark called this "leak."

**Fix — reject at the pipeline boundary, not the ranking:**

- [validate.ts](../../src/ingestion/validate.ts) now has `isDenial()` and
  `validateCandidates()` rejects any denial candidate (`reason: "agent
  denial is not a durable memory"`).
- [service.ts](../../src/service.ts) `createMemory()` also throws on
  denial content — an explicit caller instruction that denials are not
  stored. `remember()` goes through `ingest()`/`validateCandidates()`,
  so the async path is covered too.
- Retrofitted denial memories (already in a production DB) are NOT
  deleted by a migration. The denial never passes `isRetrievable()` on
  the next `recall()` because `validateCandidates` blocks new ones; a
  one-off tombstone of existing poison nodes is a manual job, not a
  background migration (destructive ops need user permission).

**Tandem check:** The real name fact stays stored (identity regex in
[extract.ts](../../src/ingestion/extract.ts) → stable). The formula
deep-test still passes 23/23 — name 0.640 > denial 0.331 — even though
denials can no longer enter the store, the scoring math is unchanged.

### 2. Skills silo (coding c4, c9 → one fixed, one remains)

**Cause:** Skills are stored in their own `skills` table and only
surfaced via `loadSkills(query)`. The `recall()` path never saw them,
so "How do I fix a failing test?" found nothing.

**Fix — project skills into the recall stream:**
- [search.ts](../../src/retrieval/search.ts) now calls
  `projectSkills()` after spreading-activation, selecting active skills
  by keyword-hit rate and materializing them as `procedure` memory nodes
  (`Skill "fix-bug": ... → Steps: ...`) scored by the same
  multi-factor formula.
- Skilled projections compete fairly with facts in the final sort; they
  carry `retentionClass: "stable"` because a proven procedure is
  durable knowledge.
- Failure reduction: c4 now passes (skill found). c9 `"Common bugfix
  steps"` still misses — the query has zero lexical overlap with the
  skill ("when a test fails" / keywords `bug,test,fix`) and the skill's
  hit rate is 0/3. That's a real limit: the keyword index only matches
  exact words. A proper embedding or synonym map would close it, but we
  don't pretend it was fixed.

### 3. Supersession by status (adaptation 70% → 100%)

**Cause:** `linkMemories()` only inserted an edge. The old decision
(PostgreSQL) stayed `active` so `isRetrievable()` kept it alive and it
surfaced beside the new one — "leak."

**Fix — supersession is a status change:**
- [service.ts](../../src/service.ts) `linkMemories()` now, when
  `relation === "supersedes"`, flips the target's status to
  `"superseded"`, sets `supersededBy: fromMemoryId`, and writes a
  revision (`reason: "supersession"`). The node is preserved in the
  revisions history — not hard-deleted — per the memory-arena rules.
- `isRetrievable()` already excludes `status !== "active"`, so the old
  memory drops out of recall, activation, and context blocks.
- The AGI test's `"[ARENA] supersession preserves history"` was updated
  to expect the new status (superseded, not active) plus history
  preserved.

**Tandem check:** Dreamer, formula, capture-dedup, and AGI suites all
still pass. Contradictions (`contradicts` relation) are untouched —
contradicted memories stay `active` per governance rule 3.

## Results (after fix)

```
AGI:             149/149 (was 147 + 2 new supersession checks)
Formula:          23/23
Dreamer:          28/28
Capture dedup:    7/7
Universal bench:  57/60  =  95%  (was 82%)
  MEMORY:     10/10  (was 6/10)
  RESEARCH:   10/10  (unchanged)
  CODING:      8/10  (was 7/10 — fix-bug now found; 2 lexical misses remain)
  ROBOTICS:    9/10  (unchanged — "steering" synonym gap remains)
  ADAPTATION: 10/10  (was 7/10)
  FORGETTING: 10/10  (unchanged)
```

Full report: [benchmarks/2026-11-08-universal-benchmark.md](../benchmarks/2026-11-08-universal-benchmark.md)
