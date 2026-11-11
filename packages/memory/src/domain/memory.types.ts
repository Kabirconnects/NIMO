// domain/memory.types.ts
// Pure domain types — no Mongoose, Express, or AI SDK imports. This is the
// contract the whole engine depends on; keep it storage-agnostic.

export type MemoryType =
  | "fact"
  | "preference"
  | "decision"
  | "event"
  | "concept"
  | "procedure"
  | "goal"
  | "observation"
  // Physical / robotic layer (domain-agnostic, per robotics memory papers)
  | "sensor"        // Raw perception: {modality, data, timestamp, uncertainty}
  | "trajectory"    // Action→outcome: {command, result, reward, context, dynamics}
  // Scientific discovery layer (per automated science / self-driving lab papers)
  | "hypothesis"    // Testable claim: {claim, prediction, test, falsifiable}
  | "experiment";   // Protocol+results: {protocol, observations, conclusion, replication}

export type MemoryStatus =
  | "candidate"
  | "active"
  | "superseded"
  | "archived"
  | "deleted";

/**
 * Retention class (A-MEM 2025): how a memory's strength decays.
 * - stable: identity, core facts, proven procedures — never fades (only corrected)
 * - volatile: lab observations, sensor readings — fades normally
 * - ephemeral: denials, transient states, failed attempts — fades fast, never outranks stable
 */
export type RetentionClass = "stable" | "volatile" | "ephemeral";

export type MemoryVisibility = "private" | "workspace" | "shared";

export type EvidenceKind = "explicit" | "inferred" | "observed" | "tool_result";

export interface MemoryEvidence {
  experienceId: string;
  messageId?: string;
  kind: EvidenceKind;
  quote?: string;
  sourceDescription?: string;
  observedAt: Date;
}

export interface MemoryEntityReference {
  entityId?: string;
  name: string;
  type: string;
}

export interface MemoryNode {
  id: string;
  ownerId: string;

  type: MemoryType;
  status: MemoryStatus;
  visibility: MemoryVisibility;

  content: string;
  summary: string;

  concepts: string[];
  keywords: string[];
  tags: string[];

  entities: MemoryEntityReference[];

  /** 0..1 — how strongly this is supported by evidence. */
  confidence: number;
  /** 0..1 — how valuable this is to retain (independent of confidence). */
  importance: number;

  /** Retention class — determines ageing behaviour (A-MEM stable/volatile). */
  retentionClass: RetentionClass;
  /** Graph centrality: number of edges (in + out). Drives dynamic base strength. */
  graphDegree: number;
  /** Legacy centrality field. Ranking no longer consumes it: the old PageRank
   *  term was permanently zero and has been removed from the score. Kept for
   *  schema compatibility; not a promised capability. */
  pageRank: number;

  evidence: MemoryEvidence[];

  validFrom?: Date;
  validUntil?: Date;

  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;

  supersedes?: string[];
  supersededBy?: string;

  /** Persisted deterministic embedding (hashed n-gram vector). Optional for
   *  legacy rows; recomputed lazily by retrieval. Never trusted as provenance. */
  embedding?: number[];
}

/** A raw, LLM-produced memory before validation/consolidation. */
export interface MemoryCandidate {
  type: MemoryType;
  content: string;
  summary: string;
  concepts: string[];
  keywords: string[];
  tags: string[];
  entities: { name: string; type: string }[];
  evidence: { quote: string; kind: EvidenceKind };
  confidence: number;
  importance: number;
  retentionClass: RetentionClass;
  temporal?: { validFrom?: string; validUntil?: string };
}
