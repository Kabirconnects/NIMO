// retrieval/rrf.ts
// Rank fusion for the hybrid retriever. Four independent rankings —
// keyword (BM25), entity, embedding-cosine, and graph activation — are
// fused by Reciprocal Rank Fusion, the standard recipe for hybrid search.
//
//   RRF(d) = Σ_i 1 / (k + rank_i(d))     with k = 60
//
// Purely deterministic — no dependency, no server.

export const RRF_K = 60;

/** Fuse ranked lists (best-first arrays of ids) into one ranked list. */
export function rrf(rankedLists: string[][]): string[] {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
