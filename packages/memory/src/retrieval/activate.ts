// retrieval/activate.ts
// Spreading activation over the memory graph — the "brain-like" part of
// recall. Seeds (keyword/entity matches) light up, and activation flows
// along synapses, decaying per hop. Connected memories that share no words
// with the query can still be pulled in if they sit next to a seed.
//
//   A(v) = S(v,q) + λ · Σ w(u,v) · A(u)
//
// Bounded hops, per-hop decay (×0.6), no runaway re-visits.
// This function is strictly READ-ONLY: recalling never reinforces an edge,
// bumps a confidence, or changes graph degree.

import type { RetrievedMemory } from "../domain/service.types.js";
import type { MemoryNode } from "../domain/memory.types.js";
import { isRetrievable } from "../governance/policy.js";
import { edgesFrom, findMemory } from "../storage/db.js";
import { computeFinalScore } from "./rank.js";

const LAMBDA = 0.5; // neighbor influence
const DECAY = 0.6;  // per-hop decay

export function activate(
  ownerId: string,
  seeds: RetrievedMemory[],
  maxHops = 2,
): RetrievedMemory[] {
  if (seeds.length === 0) return [];
  const hops = Math.min(maxHops, 4);

  const activation = new Map<string, number>(); // memoryId -> A(v)
  const matchedBy = new Map<string, RetrievedMemory["matchedBy"]>();
  const nodes = new Map<string, MemoryNode>();
  const seedById = new Map<string, RetrievedMemory>();

  // Seeds start at their already-computed final score.
  for (const s of seeds) {
    activation.set(s.memory.id, s.score);
    matchedBy.set(s.memory.id, [...s.matchedBy]);
    nodes.set(s.memory.id, s.memory);
    seedById.set(s.memory.id, s);
  }

  // Spread through the graph. Hidden/superseded nodes are not traversed —
  // otherwise a forgotten belief could still relay activation to an active one.
  let frontier = seeds.map((s) => ({ id: s.memory.id, value: s.score }));
  for (let hop = 0; hop < hops; hop++) {
    const next: { id: string; value: number }[] = [];
    for (const { id, value } of frontier) {
      if (!nodes.has(id)) continue;
      for (const edge of edgesFrom(id, ownerId)) {
        const peerId = edge.toMemoryId;
        const peer = nodes.get(peerId) ?? findMemory(peerId, ownerId);
        if (!peer || !isRetrievable(peer, ownerId)) continue;

        if (!nodes.has(peerId)) {
          nodes.set(peerId, peer);
          matchedBy.set(peerId, ["graph"]);
        } else if (!matchedBy.get(peerId)?.includes("graph")) {
          matchedBy.get(peerId)!.push("graph");
        }

        const inc = LAMBDA * edge.weight * value * (DECAY ** hop);
        const cur = activation.get(peerId) ?? 0;
        if (inc > cur) {
          activation.set(peerId, inc);
          next.push({ id: peerId, value: inc });
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // Score each node exactly once. Seeds keep their hybrid score; graph-only
  // neighbours use activation as relevance. Base/recency/confidence are not
  // re-added a second time.
  const out: RetrievedMemory[] = [];
  for (const [memId, a] of activation) {
    const node = nodes.get(memId);
    if (!node) continue;
    const seed = seedById.get(memId);
    const score = seed ? seed.score : computeFinalScore(node, Math.min(1, a));
    out.push({
      memory: node,
      score,
      matchedBy: matchedBy.get(memId) ?? ["graph"],
      relatedMemoryIds: relatedIds(memId, ownerId),
      evidence: node.evidence,
    });
  }

  out.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    const ty = y.memory.updatedAt.getTime();
    const tx = x.memory.updatedAt.getTime();
    if (ty !== tx) return ty - tx;
    return x.memory.id.localeCompare(y.memory.id);
  });
  return out;
}

function relatedIds(memoryId: string, ownerId: string): string[] {
  return edgesFrom(memoryId, ownerId).map((e) => e.toMemoryId);
}
