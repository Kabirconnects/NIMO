// retrieval/rank.ts
// Multi-factor memory strength model (A-MEM 2025 + Ebbinghaus + HippoRAG).
//
// The core formula:
//
//   base_strength(v) = importance(v) × (1 + log(1 + degree(v)) / log(1 + max_degree))
//   retention_mult   = stable: 1.0 | volatile: 1/(1+age/τ) | ephemeral: 0.3/(1+age/τ)
//   final_score      = 0.35 × base_strength × retention_mult
//                    + 0.30 × PageRank(v)
//                    + 0.20 × relevance(v,q)
//                    + 0.15 × recency(v)
//
// Research basis:
//   - A-MEM: dynamic importance from graph centrality (degree)
//   - HippoRAG: Personalized PageRank seeded by query entities
//   - Ebbinghaus: forgetting curve for volatile memories
//   - AgeMem: retention class (stable/volatile/ephemeral)
//
// Recency is a tiebreaker (weight 0.15), not the king. Importance + connectedness
// dominate — that is why a 5-month-old name fact (degree 4, stable) beats a
// 2-second-old denial (degree 0, ephemeral).

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
 * Dynamic base strength from importance + graph centrality (A-MEM Eq. 3).
 * Memories connected to many others get boosted — they are hubs, therefore important.
 */
export function baseStrength(memory: MemoryNode, maxDegree = 50): number {
  const degreeBoost = 1 + Math.log(1 + memory.graphDegree) / Math.log(1 + Math.max(2, maxDegree));
  return memory.importance * degreeBoost;
}

/**
 * Compute the full multi-factor score for a memory.
 * Returns a score 0..~2.0 (higher = more important for this query).
 */
export function computeFinalScore(
  memory: MemoryNode,
  relevance: number,
  maxDegree = 50,
): number {
  const base = baseStrength(memory, maxDegree);
  // Direct retention calc (avoid ageingStrength's RetrievedMemory wrapper)
  let retention: number;
  if (memory.retentionClass === "stable") {
    retention = 1.0;
  } else {
    const last = memory.lastAccessedAt?.getTime() ?? memory.updatedAt?.getTime?.() ?? Date.now();
    const ageMs = Math.max(0, Date.now() - last);
    const halfLife = (30 * 24 * 60 * 60 * 1000) * (1 + (memory.importance ?? 0.5));
    const decay = 1 / (1 + ageMs / halfLife);
    retention = memory.retentionClass === "ephemeral" ? decay * 0.3 : decay;
  }
  const rec = recencyScore(memory);
  const pr = memory.pageRank ?? 0; // precomputed by Dreamer; 0 if not computed yet

  return (
    0.35 * base * retention +
    0.30 * pr +
    0.20 * relevance +
    0.15 * rec
  );
}

/**
 * Sort by final score (desc), not by recency.
 * Recency is now a small component (0.15 weight) inside the score.
 */
export function rankMemories(memories: RetrievedMemory[]): RetrievedMemory[] {
  return [...memories].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = a.memory.updatedAt.getTime();
    const tb = b.memory.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    return b.memory.importance - a.memory.importance;
  });
}
