// ingestion/validate.ts
// Stage 2: classify candidates (explicit/inferred/uncertain/sensitive/
// duplicate/contradictory) and apply governance before consolidation.

import type { MemoryCandidate } from "../domain/memory.types.js";
import type { MemoryPolicy } from "../domain/governance.types.js";
import { containsExcludedContent } from "../governance/policy.js";

/**
 * Patterns that mark a candidate as an agent denial / non-fact. These are
 * the agent's own state observations ("I do not have..."), not durable
 * memories. Storing them poisons recall: the denial node ranks in top-K
 * alongside the real fact and the agent recites it back as if it were
 * knowledge (the benchmark "leak" failure). Reject them permanently.
 */
const DENIAL_PATTERNS = [
  /^\s*(i\s+do\s+not\s+have|i\s+have\s+no\s+record|i\s+don't\s+know|i\s+do\s+not\s+know|i\s+don't\s+have)\b/i,
  /\bno record of\b/i,
];

export function isDenial(content: string): boolean {
  return DENIAL_PATTERNS.some((p) => p.test(content));
}

export interface ValidationOutcome {
  accepted: MemoryCandidate[];
  rejected: { candidate: MemoryCandidate; reason: string }[];
}

export function validateCandidates(
  candidates: MemoryCandidate[],
  policy: MemoryPolicy,
): ValidationOutcome {
  const accepted: MemoryCandidate[] = [];
  const rejected: ValidationOutcome["rejected"] = [];

  for (const c of candidates) {
    if (isDenial(c.content)) {
      rejected.push({ candidate: c, reason: "agent denial is not a durable memory" });
      continue;
    }
    if (containsExcludedContent(c.content, policy)) {
      rejected.push({ candidate: c, reason: "contains excluded content" });
      continue;
    }
    if (c.evidence.kind === "inferred" && !policy.allowInferredMemories) {
      rejected.push({ candidate: c, reason: "inferred memories disabled by policy" });
      continue;
    }
    accepted.push(c);
  }

  return { accepted, rejected };
}
