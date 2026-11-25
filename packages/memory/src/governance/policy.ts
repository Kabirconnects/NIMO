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
  // Category labels. Detection is pattern-based (see below) so that ordinary
  // words like "tokenizer" or "token budget" are not mistaken for secrets.
  excludedCategories: [],
};

export type SecretCategory =
  | "private_key"
  | "aws_access_key"
  | "github_token"
  | "openai_key"
  | "slack_token"
  | "google_api_key"
  | "jwt"
  | "bearer_token"
  | "credential_url"
  | "credential_assignment";

export interface SecretDetection {
  category: SecretCategory;
}

// High-confidence credential formats. These are unambiguous.
const FORMAT_PATTERNS: { category: SecretCategory; re: RegExp }[] = [
  { category: "private_key", re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i },
  { category: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  {
    category: "github_token",
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  },
  { category: "openai_key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { category: "slack_token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { category: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    category: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    category: "bearer_token",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  },
  // scheme://user:password@host — inline DB/URL credentials
  {
    category: "credential_url",
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
  },
];

// Assignment-style secrets: "password: hunter2", "API_KEY=sk-...", etc.
// A lone mention of "token" or "password" is NOT a secret; the word must be
// followed by an assignment (or "is/was") and a value that looks secret-ish.
const ASSIGNMENT_KEYS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "api[_-]?key",
  "apikey",
  "access[_-]?key",
  "private[_-]?key",
  "client[_-]?secret",
  "auth[_-]?token",
  "access[_-]?token",
  "refresh[_-]?token",
  "session[_-]?token",
  "aws[_-]?secret[_-]?access[_-]?key",
].join("|");

const ASSIGNMENT_RE = new RegExp(
  `\\b(?:${ASSIGNMENT_KEYS})\\b\\s*(?:[:=]|\\bis\\b|\\bwas\\b)\\s*["'\`]?([^\\s"'\`,;]{3,})`,
  "i",
);

/** Values that are too boring to be secrets ("hashed", "stored", "required"). */
const BENIGN_VALUES = new Set([
  "hashed",
  "encrypted",
  "stored",
  "required",
  "optional",
  "reset",
  "changed",
  "unknown",
  "hidden",
  "expired",
  "invalid",
  "correct",
  "wrong",
  "missing",
  "disabled",
  "enabled",
]);

function looksLikeSecretValue(value: string): boolean {
  const v = value.toLowerCase();
  if (BENIGN_VALUES.has(v)) return false;
  if (v.length >= 12) return true;
  // Digit or symbol strongly suggests a real credential rather than prose.
  return /[0-9!@#$%^&*()_+\-=[\]{};:"\\|,.<>/?~`]/.test(value);
}

/** Find the first prohibited credential in `text`, if any. */
export function detectSecret(text: string): SecretDetection | null {
  if (!text) return null;
  for (const { category, re } of FORMAT_PATTERNS) {
    if (re.test(text)) return { category };
  }
  const m = ASSIGNMENT_RE.exec(text);
  if (m && looksLikeSecretValue(m[1] ?? "")) {
    return { category: "credential_assignment" };
  }
  return null;
}

/**
 * Reject content that contains prohibited material (secrets, credentials)
 * or falls under any excluded category specified in the policy.
 * `excluded_categories` adds to the built-in list, it does not replace it.
 */
export function containsExcludedContent(
  text: string,
  policy: MemoryPolicy = DEFAULT_POLICY,
): boolean {
  if (detectSecret(text) !== null) {
    return true;
  }
  const excluded = policy.excludedCategories ?? [];
  if (excluded.length === 0) {
    return false;
  }
  const lowerText = text.toLowerCase();
  for (const cat of excluded) {
    const re = new RegExp(`\\b${cat.toLowerCase().replace(/[_]/g, "[_\\- ]?")}\\b`, "i");
    if (re.test(lowerText) || lowerText.includes(cat.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Replace credential spans with a placeholder so a rejected turn can still be
 * recorded as provenance without persisting the secret. Used by ingestion
 * before the experience is captured.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const { re } of FORMAT_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), "[redacted]");
  }
  out = out.replace(
    new RegExp(ASSIGNMENT_RE.source, ASSIGNMENT_RE.flags.includes("g") ? ASSIGNMENT_RE.flags : ASSIGNMENT_RE.flags + "g"),
    (match, value: string) => (looksLikeSecretValue(value) ? "[redacted]" : match),
  );
  return out;
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

/** Owner + visibility + status filter applied to retrieval results. */
export function isRetrievable(node: MemoryNode, ownerId: string, policy: MemoryPolicy = DEFAULT_POLICY): boolean {
  // Defence in depth: repositories also scope by ownerId in the query.
  if (node.ownerId !== ownerId) {
    return false;
  }
  if (node.status !== "active") {
    return false;
  }
  const nowTime = Date.now();
  if (node.validFrom && node.validFrom.getTime() > nowTime) {
    return false;
  }
  if (node.validUntil && node.validUntil.getTime() <= nowTime) {
    return false;
  }
  if (policy.maxEvidenceAgeDays !== undefined && policy.maxEvidenceAgeDays > 0 && node.evidence && node.evidence.length > 0) {
    // The age is measured from the NEWEST piece of evidence: a memory is only
    // stale when every observation behind it is stale.
    //
    // `observedAt` is typed `Date`, but the value a stored node carries is
    // whatever `JSON.parse` produced - an ISO string - because the evidence is
    // persisted as JSON text (`memory_policies`/`memories.evidence`) and read
    // back with a plain parse. `Number("2026-11-15T...")` is NaN, so a check
    // written against `Number(...)` can never fire: the limit is configured,
    // the evidence is old, and the memory is still retrievable. Parse the
    // value that is actually there, and tolerate all three shapes (a Date, a
    // number of epoch milliseconds, an ISO string) so a caller holding a
    // freshly built node and a caller holding a stored one agree.
    let newestTime = 0;
    for (const ev of node.evidence) {
      const raw: unknown = ev.observedAt;
      const t =
        raw instanceof Date
          ? raw.getTime()
          : typeof raw === "number"
            ? raw
            : typeof raw === "string"
              ? Date.parse(raw)
              : NaN;
      if (Number.isFinite(t) && t > newestTime) {
        newestTime = t;
      }
    }
    // No usable timestamp at all: the age is unknown, not zero. A memory
    // without evidence dates is not filtered out - there is nothing to judge.
    if (newestTime > 0) {
      const ageDays = (nowTime - newestTime) / (1000 * 60 * 60 * 24);
      if (ageDays > policy.maxEvidenceAgeDays) {
        return false;
      }
    }
  }
  return true;
}
