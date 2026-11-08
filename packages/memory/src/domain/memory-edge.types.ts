// domain/memory-edge.types.ts
// Associations between memories. Every edge is typed and (where the relation
// is directional) one-way. A generic "related_to" must never replace a more
// specific relation like "contradicts" or "supersedes".

export type MemoryRelation =
  | "related_to"
  | "about"
  | "supports"
  | "contradicts"
  | "explains"
  | "caused_by"
  | "part_of"
  | "derived_from"
  | "supersedes"
  | "depends_on"
  | "occurred_before"
  | "occurred_after"
  // Causal / scientific / robotic edges (domain-agnostic)
  | "causes"        // A causes B (causal chain: gene_edit → phenotype, steer → turn)
  | "enables"       // A enables B (prerequisite: balance → walk, calibration → experiment)
  | "observes"      // Sensor observes trajectory (perception→action pairing)
  | "tests"         // Experiment tests hypothesis (scientific method loop)
  | "replicates";   // Experiment replicates experiment (reproducibility)

export interface MemoryEdge {
  id: string;
  ownerId: string;

  fromMemoryId: string;
  toMemoryId: string;

  relation: MemoryRelation;

  /** 0..1 — strength of the association. */
  weight: number;
  /** 0..1 — how sure we are this edge is real. */
  confidence: number;

  /** Evidence that justifies the edge — empty is allowed only for weak links. */
  evidenceIds: string[];

  createdAt: Date;
  updatedAt: Date;
}
