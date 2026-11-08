// governance/policy.ts
// The policy engine. Runs BEFORE persistence and BEFORE retrieval.
// Enforces: explicit > inferred, no secrets, no cross-owner leakage,
// explicit corrections override old memories.

import type {
  GovernanceResult,
  MemoryAction,
  MemoryPolicy,
} from "../domain/governance.types.js";
import type { MemoryNode } from "../domain/memory.types.js";

export const DEFAULT_POLICY: MemoryPolicy = {
  allowAutomaticCapture: true,
  allowInferredMemories: true,
  allowAutomaticMerge: true,
  allowAutomaticEvolution: true,
  defaultVisibility: "private",
  maxMemoryConfidenceForAutoActivation: 0.5,
  excludedCategories: [
    "password",
    "api key",
    "api_key",
    "apikey",
    "secret",
    "token",
    "credential",
    "aws_access_key",
    "private key",
    "authorization",
    "bearer ",
  ],
};

/**
 * Reject content that contains prohibited material (secrets, credentials).
 * Deliberately simple string matching for Stage 1 — Stage 2 adds an
 * entropy/pattern-based scanner.
 */
export function containsExcludedContent(text: string, policy: MemoryPolicy): boolean {
  const lower = text.toLowerCase();
  return policy.excludedCategories.some((c) => lower.includes(c.toLowerCase()));
}

/** Gate a write-side action against policy. */
export function evaluateWrite(
  action: MemoryAction,
  content: string | undefined,
  policy: MemoryPolicy,
): GovernanceResult {
  if (content && containsExcludedContent(content, policy)) {
    return {
      decision: "deny",
      reason: "Content contains prohibited material (secret/credential).",
      requiresConfirmation: false,
    };
  }
  if (action === "create" && !policy.allowAutomaticCapture) {
    return { decision: "deny", reason: "Automatic capture is disabled by policy.", requiresConfirmation: false };
  }
  if (action === "merge" && !policy.allowAutomaticMerge) {
    return { decision: "deny", reason: "Automatic merge is disabled by policy.", requiresConfirmation: false };
  }
  if (action === "delete") {
    return {
      decision: "require_confirmation",
      reason: "Deletion requires explicit user confirmation.",
      requiresConfirmation: true,
    };
  }
  return { decision: "allow", reason: "Within policy.", requiresConfirmation: false };
}

/** Owner + visibility + status filter applied to retrieval results.
 *  Defence in depth: repositories also scope by ownerId in the query. */
export function isRetrievable(node: MemoryNode, ownerId: string): boolean {
  if (node.ownerId !== ownerId) return false;
  if (node.status !== "active") return false;
  if (node.validUntil && node.validUntil.getTime() < Date.now()) return false;
  return true;
}
