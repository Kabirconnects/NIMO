// retrieval/rank.ts
// Multi-factor memory strength model (A-MEM 2025 + Ebbinghaus).
//
//   base_strength(v) = importance(v) × (1 + log(1 + degree(v)) / log(1 + max_degree))
//   base_norm(v)     = min(1, base_strength(v) / 2)
//   effective_recency= stable: 1 | volatile: recency | ephemeral: 0.3 × recency
//   final_score      = 0.35 × relevance
//                    + 0.40 × base_norm
//                    + 0.15 × effective_recency
//                    + 0.10 × confidence
//
// The old formula reserved 0.30 for PageRank, but PageRank was never computed
// in production — the term was permanently zero and silently diluted every
// real signal. It has been removed and the remaining weights renormalised.
// Graph centrality still contributes through `base_strength` (degree), and
// stability contributes exactly once through `effective_recency`.
//
// Recency is a tiebreaker, not the king. Importance + connectedness dominate —
// a 5-month-old stable identity fact beats a fresh ephemeral observation.

import type { RetrievedMemory } from "../domain/service.types.js";
import type { MemoryNode } from "../domain/memory.types.js";

/**
 * Recency: 1/(1 + age_days/30). Fresh = 1, 30 days = 0.5, 150 days = 0.17.
 */
export function recencyScore(memory: MemoryNode, nowMs: number = Date.now()): number {
  const last = memory.lastAccessedAt?.getTime() ?? memory.updatedAt?.getTime?.() ?? nowMs;
  const ageMs = Math.max(0, nowMs - last);
  return 1 / (1 + ageMs / (30 * 24 * 60 * 60 * 1000));
}

/**
 * Ageing strength: decays with age since last access, but access refreshes it.
 * Retention class determines the floor:
 *   stable:    never fades (1.0)
 *   volatile:  normal Ebbinghaus decay
 *   ephemeral: fast decay (×0.3)
 */
export function ageingStrength(memory: RetrievedMemory["memory"], nowMs: number = Date.now()): number {
  if (memory.retentionClass === "stable") return 1.0;
  const last = memory.lastAccessedAt?.getTime() ?? memory.updatedAt?.getTime?.() ?? nowMs;
  const ageMs = Math.max(0, nowMs - last);
  const halfLife = (30 * 24 * 60 * 60 * 1000) * (1 + (memory.importance ?? 0.5));
  const decay = 1 / (1 + ageMs / halfLife);
  return memory.retentionClass === "ephemeral" ? decay * 0.3 : decay;
}

/**
 * Single, non-double-counted retention effect used by the final score.
 * Stable memories always read as fully recent; ephemeral ones fade fast.
 */
export function effectiveRecency(memory: MemoryNode, nowMs: number = Date.now()): number {
  if (memory.retentionClass === "stable") return 1.0;
  const rec = recencyScore(memory, nowMs);
  return memory.retentionClass === "ephemeral" ? rec * 0.3 : rec;
}

/**
 * Dynamic base strength from importance + graph centrality (A-MEM Eq. 3).
 * Memories connected to many others get boosted — they are hubs, therefore
 * important.
 */
export function baseStrength(memory: MemoryNode, maxDegree = 50): number {
  const degreeBoost = 1 + Math.log(1 + memory.graphDegree) / Math.log(1 + Math.max(2, maxDegree));
  return memory.importance * degreeBoost;
}

/** Normalised 0..1 base strength so weights are comparable. */
export function normalisedBase(memory: MemoryNode, maxDegree = 50): number {
  return Math.min(1, baseStrength(memory, maxDegree) / 2);
}

/**
 * Compute the full multi-factor score for a memory.
 * Returns a score 0..1 (higher = more important for this query).
 */
export function computeFinalScore(
  memory: MemoryNode,
  relevance: number,
  maxDegree = 50,
): number {
  const base = normalisedBase(memory, maxDegree);
  const rec = effectiveRecency(memory);
  const confidence = Math.min(1, Math.max(0, memory.confidence ?? 0.5));
  const rel = Math.min(1, Math.max(0, relevance));

  return (
    0.35 * rel +
    0.40 * base +
    0.15 * rec +
    0.10 * confidence
  );
}

/**
 * Sort by final score (desc), not by recency. Ties break on updatedAt then id
 * so retrieval is deterministic for identical data.
 */
export function rankMemories(memories: RetrievedMemory[]): RetrievedMemory[] {
  return [...memories].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = a.memory.updatedAt.getTime();
    const tb = b.memory.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    return a.memory.id.localeCompare(b.memory.id);
  });
}
