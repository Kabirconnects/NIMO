// domain/governance.types.ts
// What PAME is allowed to do. A policy belongs to a user/workspace, not to a
// conversation, and the engine runs BEFORE persistence and BEFORE retrieval.

import type { MemoryVisibility } from "./memory.types.js";

export type MemoryAction =
  | "create"
  | "update"
  | "link"
  | "merge"
  | "archive"
  | "supersede"
  | "delete"
  | "retrieve";

export type GovernanceDecision = "allow" | "deny" | "require_confirmation";

export interface MemoryPolicy {
  allowAutomaticCapture: boolean;
  allowInferredMemories: boolean;
  allowAutomaticMerge: boolean;
  allowAutomaticEvolution: boolean;

  defaultVisibility: MemoryVisibility;

  maxEvidenceAgeDays?: number;
  maxMemoryConfidenceForAutoActivation: number;

  /** Substrings/categories that must never be stored (e.g. credentials). */
  excludedCategories: string[];
}

export interface GovernanceResult {
  decision: GovernanceDecision;
  reason: string;
  requiresConfirmation: boolean;
}

export interface MemoryRevision {
  id: string;
  memoryId: string;
  ownerId: string;

  previousContent?: string;
  newContent: string;

  reason: "new_evidence" | "user_correction" | "consolidation" | "supersession";

  evidenceIds: string[];

  createdAt: Date;
}

/** Audit record — who/what did what, to which target, and why. No secrets. */
export interface MemoryAuditEntry {
  id: string;
  ownerId: string;
  actor: "agent" | "user" | "system" | "worker";
  action: MemoryAction;
  targetId: string;
  reason?: string;
  createdAt: Date;
}
