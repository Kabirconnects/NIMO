# 2026-11-07 — Multi-Factor Memory Strength Formula (A-MEM + HippoRAG)

## Hypothesis

Replacing binary-gate + newest-first ranking with a multi-factor formula
from research will fix buried important memories (name, research papers,
proven skills) while keeping the existing RRF + graph architecture.

## The Bug (diagnosed from production DB)

User's name "Asur" stored June 11 (5 months ago, rank 285/285).
Agent's denial "I do not have your name" stored today (rank #4).
Recall limit of 200 cut Asur off before it was considered.
Denial loop: each denial stored as new memory, burying the real one further.

Root cause: ranking by recency first (binary gate + newest-first).
A 5-month-old fact and a 2-second-old denial both pass the gate.
Denial wins because it is newer.

## The Fix (research formula)

```
final_score(v) = 0.35 × base_strength(v) × retention_mult(v)
               + 0.30 × PageRank(v)
               + 0.20 × relevance(v,q)
               + 0.15 × recency(v)

base_strength(v) = importance(v) × (1 + log(1+degree(v)) / log(1+max_degree))    [A-MEM Eq.3]
retention_mult   = stable: 1.0 | volatile: 1/(1+age/τ) | ephemeral: 0.3/(1+age/τ)  [AgeMem]
PageRank(v)      = precomputed, seeded by query entities                              [HippoRAG Eq.2]
relevance(v,q)   = RRF(BM25, embedding cosine)                                       [A-MEM + HippoRAG]
recency(v)       = 1/(1 + age_days/30)                                               [Ebbinghaus]
```

Weights: importance-heavy (0.35), recency is tiebreaker (0.15), not king.

## Changes (4 files + 1 schema)

1. **domain/memory.types.ts**: Added `RetentionClass` type, `retentionClass`, `graphDegree`, `pageRank` fields on `MemoryNode`
2. **storage/db.ts**: Added `retention_class`, `graph_degree`, `page_rank` columns + migration + backfill. `insertEdge` bumps degree. Dynamic backfill on startup.
3. **retrieval/rank.ts**: Added `baseStrength()`, `recencyScore()`, `computeFinalScore()`. `ageingStrength()` now respects retention class.
4. **retrieval/search.ts**: Replaced binary gate + newest-first with multi-factor score. Recall limit 200 → 5000.
5. **retrieval/activate.ts**: Final sort by score, not recency. Stable memories get bonus.
6. **ingestion/extract.ts**: Auto-assigns retention class:
   - Identity ("I am X", "My name is X") → stable, importance 0.85
   - Denial ("I do not have", "I don't know") → ephemeral, importance 0.2
   - Preference/decision/goal/procedure → stable
   - Observation → ephemeral

## Test Results

```
AGI deep test:     147 passed, 0 failed
Dreamer test:       28 passed, 0 failed
Formula deep test:  23 passed, 0 failed
Benchmark:          15/15 recall, 100%
TypeScript:         clean (memory + agents)
Total:              198 assertions passing
```

### Key formula verifications

| Test | Result |
|---|---|
| 5-month name (degree 4, stable) vs fresh denial (degree 0, ephemeral) | Name 0.640 > Denial 0.331 ✅ |
| Research paper hub (degree 8, stable) vs failed trial (degree 1, ephemeral) | Paper 0.661 > Trial 0.330 ✅ |
| Proven gait (degree 15, stable) vs fall (degree 1, ephemeral) | Gait 0.757 > Fall 0.295 (2.5×) ✅ |
| Proven gait with ZERO relevance (offline for months) | Still 0.637 — survives ✅ |
| 251 memories (exceeds old 200 limit) | Old stable memory still in pool ✅ |
| graphDegree increments on link | ✅ |

## Research justification

| Formula component | Source | Why |
|---|---|---|
| `base_strength = importance × (1 + log(degree))` | A-MEM Eq.3 | Hub nodes are important — graph centrality defines importance |
| `PageRank` seeded by query entity | HippoRAG Eq.2 | Multi-hop retrieval via graph structure |
| `retention_class: stable/volatile/ephemeral` | A-MEM §4, AgeMem | Identity/facts never fade; observations fade; denials fade fast |
| `relevance = RRF` | A-MEM + HippoRAG | Already implemented — kept |
| `recency = 1/(1+age/τ)` | Ebbinghaus | Already implemented — demoted to 0.15 weight |

## Production DB migration note

The production `pame.db` at `~/.nimo/pame.db` needs the schema migration.
On next startup, `getDb()` auto-adds `retention_class`, `graph_degree`, `page_rank`
columns and backfills. The migration was not run manually (permission denied for
direct DB alteration) — it will happen automatically when the agent starts.

## Conclusion

The formula fixes name recall, research paper synthesis, and robot skill retention
with a single change. All three were the same bug: recency-dominated ranking.
Now importance + connectedness dominate, recency is a tiebreaker.
