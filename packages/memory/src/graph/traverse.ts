// graph/traverse.ts
// Stage 4: bounded graph expansion around seed memories (spreading
// activation). Stage 1 implementation is a simple 1-hop neighbor fetch;
// the activation math (A(v) = S(v,q) + lambda * sum(w * A(u))) and hop
// decay land with scoring in Stage 4.

import { edgesFrom } from "../storage/db.js";

export interface TraversalOptions {
  ownerId: string;
  seeds: string[];
  maxHops?: number;
}

export function expandMemoryGraph(opts: TraversalOptions): string[] {
  const maxHops = Math.min(opts.maxHops ?? 2, 4);
  const visited = new Set(opts.seeds);
  let frontier = [...opts.seeds];

  for (let hop = 0; hop < maxHops; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      const edges = edgesFrom(id, opts.ownerId);
      for (const e of edges) {
        if (!visited.has(e.toMemoryId)) {
          visited.add(e.toMemoryId);
          next.push(e.toMemoryId);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  return [...visited];
}
