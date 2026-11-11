// graph/conflict.ts
// Distinguishes SIMILARITY from CONTRADICTION.
//
// Two memories can share almost every word and still be compatible
// ("prefers concise answers" / "prefers concise answers with code examples"),
// or share only a subject and directly conflict ("we use mongodb" /
// "we use postgres"). The old code treated keyword overlap as contradiction,
// which merged opposing preferences and raised confidence on repetition.
//
// This classifier is deterministic and rule-based:
//   - duplicate      : same normalised text / near-identical embedding
//   - compatible     : related, and one value slot refines the other
//   - contradiction  : negation flip, numeric conflict, or incompatible value
//   - correction     : contradiction/correction marker in the incoming memory
//   - unrelated      : no meaningful relation
//
// `contradicts` edges should only be created for contradiction/correction.

import type { MemoryNode } from "../domain/memory.types.js";
import { embedText, cosSim } from "../retrieval/embed.js";

export type ConflictKind =
  | "duplicate"
  | "compatible"
  | "contradiction"
  | "correction"
  | "unrelated";

export interface ConflictAssessment {
  kind: ConflictKind;
  /** Embedding cosine similarity (0..1). Similarity alone is NOT conflict. */
  similarity: number;
  /** 0 for duplicate/compatible/unrelated; high for contradiction/correction. */
  contradictionScore: number;
  reason: string;
}

/** The minimal shape needed to compare two memories or a candidate. */
export interface ConflictInput {
  content: string;
  summary?: string;
  keywords?: string[];
  type?: string;
  retentionClass?: string;
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "by",
  "for", "with", "from", "as", "is", "are", "was", "were", "be", "been",
  "being", "it", "its", "this", "that", "these", "those", "i", "we", "you",
  "he", "she", "they", "my", "our", "your", "their", "me", "us", "them",
  "do", "does", "did", "have", "has", "had", "will", "would", "should",
  "can", "could", "may", "might", "must", "very", "really", "just", "also",
  "so", "than", "then", "there", "here", "when", "where", "which", "who",
  "what", "how", "why", "if", "because", "about", "into", "over", "under",
]);

const NEGATION_RE =
  /\b(?:not|no|never|without|dont|doesnt|didnt|isnt|arent|wasnt|werent|wont|wouldnt|cant|cannot|shouldnt|couldnt)\b/i;

const CORRECTION_RE =
  /\b(?:actually|correction|correcting|i\s+was\s+wrong|that'?s\s+wrong|instead|no\s+longer|not\s+anymore|changed\s+to|we\s+now|now\s+we|update:|to\s+clarify|my\s+mistake)\b/i;

// A verb that owns a value slot. "we use X" / "prefers X" / "stores X in Y".
const VALUE_VERB_RE = new RegExp(
  String.raw`\b(use|uses|using|used|prefer|prefers|preferred|like|likes|love|loves|` +
  String.raw`want|wants|need|needs|store|stores|stored|storing|` +
  String.raw`decided(?:\s+to)?|choose|chose|chosen|adopt|adopted|` +
  String.raw`switch(?:ed)?\s+to|migrat(?:e|ed)\s+to|set|sets)\b\s+(.+)$`,
  "i",
);

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function coreSet(text: string): Set<string> {
  return new Set(tokens(text));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

function isSubset(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function numbers(text: string): number[] {
  return (text.match(/\b\d+(?:\.\d+)?\b/g) ?? []).map(Number);
}

function valueSlot(text: string): { verb: string; rest: Set<string> } | null {
  const m = VALUE_VERB_RE.exec(text);
  if (!m) return null;
  const verb = (m[1] ?? "").toLowerCase().split(/\s+/)[0] ?? "";
  return { verb, rest: coreSet(m[2] ?? "") };
}

function swappedOverPair(text: string): [string, string] | null {
  const m = /\b([a-z0-9]+)\s+over\s+([a-z0-9]+)\b/i.exec(normalise(text));
  return m && m[1] !== undefined && m[2] !== undefined ? [m[1], m[2]] : null;
}

function contentKey(input: ConflictInput): string {
  return normalise(input.content);
}

export function assessConflict(
  existing: ConflictInput,
  incoming: ConflictInput,
): ConflictAssessment {
  const a = contentKey(existing);
  const b = contentKey(incoming);
  const aFull = `${existing.content} ${existing.summary ?? ""}`.trim();
  const bFull = `${incoming.content} ${incoming.summary ?? ""}`.trim();
  const similarity = cosSim(embedText(aFull), embedText(bFull));

  // 1) Exact duplicate.
  if (a === b && a.length > 0) {
    return {
      kind: "duplicate",
      similarity: 1,
      contradictionScore: 0,
      reason: "identical normalised content",
    };
  }

  // 2) Embedding near-duplicate with the same value vocabulary.
  const setA = coreSet(aFull);
  const setB = coreSet(bFull);
  const jac = jaccard(setA, setB);
  const overlap = overlapCoefficient(setA, setB);
  if (similarity >= 0.92 && jac >= 0.8) {
    return {
      kind: "duplicate",
      similarity,
      contradictionScore: 0,
      reason: "near-identical content",
    };
  }

  const related =
    (setA.size > 0 && setB.size > 0 && overlap >= 0.5 && jac >= 0.15) ||
    similarity >= 0.45 ||
    hasSharedSubject(setA, setB);

  if (!related) {
    return {
      kind: "unrelated",
      similarity,
      contradictionScore: 0,
      reason: "no meaningful shared subject",
    };
  }

  const incomingIsCorrection = CORRECTION_RE.test(incoming.content);

  // 3) Polarity flip: same vocabulary, opposite negation.
  const negA = NEGATION_RE.test(aFull);
  const negB = NEGATION_RE.test(bFull);
  if (negA !== negB && (jac >= 0.45 || overlap >= 0.7)) {
    return {
      kind: incomingIsCorrection ? "correction" : "contradiction",
      similarity,
      contradictionScore: incomingIsCorrection ? 0.95 : 0.85,
      reason: "polarity/negation differs on shared vocabulary",
    };
  }

  // 4) Relation inversion: "X over Y" vs "Y over X".
  const pairA = swappedOverPair(aFull);
  const pairB = swappedOverPair(bFull);
  if (pairA && pairB && pairA[0] === pairB[1] && pairA[1] === pairB[0] && pairA[0] !== pairA[1]) {
    return {
      kind: incomingIsCorrection ? "correction" : "contradiction",
      similarity,
      contradictionScore: incomingIsCorrection ? 0.95 : 0.85,
      reason: `preference order inverted (${pairA[0]} over ${pairA[1]} vs ${pairB[0]} over ${pairB[1]})`,
    };
  }

  // 5) Numeric conflict on the same subject (30s vs 60s, 2 cats vs 3 cats).
  const numsA = numbers(aFull);
  const numsB = numbers(bFull);
  if (numsA.length > 0 && numsB.length > 0 && numsA.join(",") !== numsB.join(",") && overlap >= 0.5) {
    return {
      kind: incomingIsCorrection ? "correction" : "contradiction",
      similarity,
      contradictionScore: incomingIsCorrection ? 0.95 : 0.8,
      reason: `numeric values differ (${numsA.join(",")} vs ${numsB.join(",")})`,
    };
  }

  // 6) Value-slot conflict: same verb, incompatible object.
  const slotA = valueSlot(existing.content);
  const slotB = valueSlot(incoming.content);
  if (slotA && slotB && slotA.verb === slotB.verb) {
    const subset =
      isSubset(slotA.rest, slotB.rest) || isSubset(slotB.rest, slotA.rest);
    const sameValues =
      jaccard(slotA.rest, slotB.rest) >= 0.8 &&
      isSubset(slotA.rest, slotB.rest) &&
      isSubset(slotB.rest, slotA.rest);
    if (!subset && !sameValues) {
      return {
        kind: incomingIsCorrection ? "correction" : "contradiction",
        similarity,
        contradictionScore: incomingIsCorrection ? 0.95 : 0.8,
        reason: `same action "${slotA.verb}" with incompatible values`,
      };
    }
  }

  // 7) A correction marker on otherwise-related content is a correction even
  //    when the surface values look compatible.
  if (incomingIsCorrection && (jac >= 0.3 || overlap >= 0.6)) {
    return {
      kind: "correction",
      similarity,
      contradictionScore: 0.9,
      reason: "explicit correction marker",
    };
  }

  return {
    kind: "compatible",
    similarity,
    contradictionScore: 0,
    reason: "related but not conflicting",
  };
}

/** Shared non-trivial subject token (nouns/verbs after stopword removal). */
function hasSharedSubject(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  let inter = 0;
  for (const x of a) if (b.has(x) && x.length >= 4) inter++;
  // At least two content words shared, or one very specific long token.
  if (inter >= 2) return true;
  if (inter === 1) {
    for (const x of a) if (b.has(x) && x.length >= 7) return true;
  }
  return false;
}

/** Convenience for callers holding MemoryNode values. */
export function assessMemoryConflict(
  existing: MemoryNode,
  incoming: MemoryNode,
): ConflictAssessment {
  return assessConflict(existing, incoming);
}

/** 0..1 contradiction strength. Similarity alone never produces a conflict. */
export function contradictionScore(a: ConflictInput, b: ConflictInput): number {
  return assessConflict(a, b).contradictionScore;
}
