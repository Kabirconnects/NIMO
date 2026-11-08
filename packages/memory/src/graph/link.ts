// graph/link.ts
// Stage 4: propose + validate typed edges. The LLM judge (Stage 4) produces
// ProposedMemoryLink; Stage 1 exposes only the validated create path.

import type { MemoryEdge, MemoryRelation } from "../domain/memory-edge.types.js";
import { insertEdge } from "../storage/db.js";

export interface ProposedMemoryLink {
  targetMemoryId: string;
  relation: MemoryRelation;
  confidence: number;
  weight: number;
  reasoning: string;
  evidenceIds: string[];
}

/** Stage-1 guardrails: never link across owners, never auto-link weak edges. */
export function shouldCreateLink(p: ProposedMemoryLink): boolean {
  if (p.confidence < 0.4) return false;
  if ((p.relation === "contradicts" || p.relation === "supersedes") && p.confidence < 0.9)
    return false; // strict evidence for high-impact relations
  return true;
}

export function createLink(
  fromMemoryId: string,
  ownerId: string,
  p: ProposedMemoryLink,
): MemoryEdge | null {
  if (!shouldCreateLink(p)) return null;
  return insertEdge({
    ownerId,
    fromMemoryId,
    toMemoryId: p.targetMemoryId,
    relation: p.relation,
    weight: p.weight,
    confidence: p.confidence,
    evidenceIds: p.evidenceIds,
  });
}
