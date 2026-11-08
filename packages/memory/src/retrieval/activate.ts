// retrieval/activate.ts
// Spreading activation over the memory graph — the "brain-like" part of
// recall. Seeds (keyword/entity matches) light up, and activation flows
// along synapses, decaying per hop. Connected memories that share no words
// with the query can still be pulled in if they sit next to a seed.
//
//   A(v) = S(v,q) + λ · Σ w(u,v) · A(u)
//
// Bounded hops, per-hop decay (×0.6), no runaway re-visits.

import type { RetrievedMemory } from "../domain/service.types.js";
import type { MemoryNode } from "../domain/memory.types.js";
import { isRetrievable } from "../governance/policy.js";
import { edgesFrom, findMemory } from "../storage/db.js";

const LAMBDA = 0.5; // neighbor influence
const DECAY = 0.6;  // per-hop decay

export function activate(
  ownerId: string,
  seeds: RetrievedMemory[],
  maxHops = 2,
): RetrievedMemory[] {
  if (seeds.length === 0) return seeds;
  const hops = Math.min(maxHops, 4);

  const activation = new Map<string, number>(); // memoryId -> A(v)
  const matchedBy = new Map<string, RetrievedMemory["matchedBy"]>();
  const nodes = new Map<string, MemoryNode>();

  // Seeds start at their keyword score.
  for (const s of seeds) {
    activation.set(s.memory.id, s.score);
    matchedBy.set(s.memory.id, [...s.matchedBy]);
    nodes.set(s.memory.id, s.memory);
  }

  // Spread through the graph.
  let frontier = seeds.map((s) => ({ id: s.memory.id, value: s.score }));
  for (let hop = 0; hop < hops; hop++) {
    const next: { id: string; value: number }[] = [];
    for (const { id, value } of frontier) {
      for (const edge of edgesFrom(id, ownerId)) {
        const peerId = edge.toMemoryId;
        const inc = LAMBDA * edge.weight * value * (DECAY ** hop);
        const cur = activation.get(peerId) ?? 0;
        const nextValue = Math.max(cur, inc);
        if (nextValue > cur) activation.set(peerId, nextValue);

        if (!nodes.has(peerId)) {
          const node = findMemory(peerId, ownerId);
          if (node && isRetrievable(node, ownerId)) {
            nodes.set(peerId, node);
            matchedBy.set(peerId, ["graph"]);
          }
        } else if (!matchedBy.get(peerId)?.includes("graph")) {
          matchedBy.get(peerId)!.push("graph");
        }
        next.push({ id: peerId, value: nextValue });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // Blend activation into the final score.
  // Activation spreads through the graph, but stable memories resist decay.
  const out: RetrievedMemory[] = [];
  for (const [memId, a] of activation) {
    const node = nodes.get(memId);
    if (!node) continue;
    const base = seeds.find((s) => s.memory.id === memId)?.score ?? 0;
    // Stable memories get bonus (they are core knowledge, not fading observations)
    const stabilityBonus = node.retentionClass === "stable" ? 0.1 : 0;
    const score = Math.max(base, a) + node.importance * 0.05 + stabilityBonus;
    out.push({
      memory: node,
      score: Math.min(2, score),  // allow up to 2.0 for multi-factor scoring
      matchedBy: matchedBy.get(memId) ?? ["graph"],
      relatedMemoryIds: relatedIds(memId, ownerId),
      evidence: node.evidence,
    });
  }

  // Sort by score (multi-factor), not pure recency.
  out.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const ty = y.memory.updatedAt.getTime();
    const tx = x.memory.updatedAt.getTime();
    if (ty !== tx) return ty - tx;
    return y.memory.importance - x.memory.importance;
  });
  return out;
}

function relatedIds(memoryId: string, ownerId: string): string[] {
  return edgesFrom(memoryId, ownerId).map((e) => e.toMemoryId);
}
