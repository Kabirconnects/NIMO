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
  excludedCategories: [
    "password",
    "api_key",
    "secret",
    "credential",
    "aws_access_key",
    "private_key",
    "authorization",
    "bearer_token",
  ],
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
 * Reject content that contains prohibited material (secrets, credentials).
 * Pattern-based, with word boundaries, so "tokenizer" and "token budget" pass.
 */
export function containsExcludedContent(
  text: string,
  _policy: MemoryPolicy = DEFAULT_POLICY,
): boolean {
  return detectSecret(text) !== null;
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

/** Owner + visibility + status filter applied to retrieval results.
 *  Defence in depth: repositories also scope by ownerId in the query. */
export function isRetrievable(node: MemoryNode, ownerId: string): boolean {
  if (node.ownerId !== ownerId) return false;
  if (node.status !== "active") return false;
  if (node.validUntil && node.validUntil.getTime() < Date.now()) return false;
  return true;
}
