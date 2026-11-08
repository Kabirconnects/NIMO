// graph/evolve.ts
// Stage 5: conservative memory evolution — re-evaluate related memories when
// new evidence arrives. Stage 1 is a documented placeholder so the surface
// exists; the rules (supersede on explicit correction, retain contradictions,
// never auto-invent certainty) are recorded in agent.md §5.

export interface EvolutionInput {
  ownerId: string;
  memoryId: string;
  /** kind of new evidence driving the re-evaluation */
  cause: "new_evidence" | "user_correction" | "consolidation";
}

export function evolve(_input: EvolutionInput): { changed: boolean } {
  // TODO(Stage 5): reconcile contradictions, apply supersession, update
  // confidence, write MemoryRevision + audit entries.
  return { changed: false };
}
