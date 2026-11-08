// ingestion/extract.ts
// Stage 2: extract MemoryCandidate[] from an experience. Rule-based (regex + heuristics),
// no LLM — deterministic, fast, and testable. The candidates are validated by
// ingestion/validate.ts before any write.

import type { Experience } from "../domain/experience.types.js";
import type { MemoryCandidate, MemoryType, RetentionClass } from "../domain/memory.types.js";

const GREETINGS = new Set([
  "hi", "hello", "hey", "yo", "namaste", "good morning", "good evening",
  "good afternoon", "what's up", "whats up", "sup", "hola", "bye", "goodbye",
]);

export function isGreeting(content: string): boolean {
  const t = content.toLowerCase().replace(/[.!?,]+$/g, "").trim();
  return GREETINGS.has(t);
}

const MEMORY_TYPES: { type: MemoryType; patterns: RegExp[]; retention: RetentionClass }[] = [
  {
    type: "preference",
    patterns: [
      /\b(i|we)\s+(prefer|like|love|enjoy|want)\b/i,
      /\b(i|we)\s+(don't|do not|never)\s+(like|want|prefer)\b/i,
      /\bprefer\b/i,
      /\balways\b.*\b(use|do|call)\b/i,
    ],
    retention: "stable",
  },
  {
    type: "decision",
    patterns: [
      /\bwe(\s+)?(decided|chose|went with|picked|selected)\b/i,
      /\b(decided to|chose to|opted for)\b/i,
      /\blet's (use|go with)\b/i,
    ],
    retention: "stable",
  },
  {
    type: "fact",
    patterns: [
      /\b(is|are|was|were|uses?|powered by|built (with|on|using))\b/i,
      /\b(project|tool|library|framework|stack|system|app)\b/i,
    ],
    retention: "volatile",
  },
  {
    type: "event",
    patterns: [
      /\b(fixed|broke|fixed|resolved|shipped|deployed|released|merged|renamed|deleted|created|added|removed)\b/i,
    ],
    retention: "volatile",
  },
  {
    type: "concept",
    patterns: [
      /\b(architecture|system|pattern|design|concept|principle|approach)\b/i,
    ],
    retention: "volatile",
  },
  {
    type: "goal",
    patterns: [
      /\b(goal|target|aim|objective|need to|must|should|going to)\b/i,
    ],
    retention: "stable",
  },
  {
    type: "procedure",
    patterns: [
      /\b(how to|steps to|run|start|setup|install|configure)\b/i,
    ],
    retention: "stable",
  },
  {
    type: "observation",
    patterns: [
      /\b(error|warning|failed|exception|crash|bug|issue)\b/i,
    ],
    retention: "ephemeral",
  },
];

/** Extract one candidate per line (or the whole message if one line). */
export function extractCandidates(content: string): MemoryCandidate[] {
  const text = content.trim();
  if (!text) return [];

  // Greetings are conversation glue, not durable memories — capture the
  // experience (context) but don't form a neuron from it.
  if (isGreeting(text)) return [];

  const sentences: string[] = [];
  for (const part of text.split(/\r?\n/)) {
    const line = part.trim();
    if (!line) continue;
    // Split long lines into sentences.
    const sents = line.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const s of sents) sentences.push(s);
  }

  const candidates: MemoryCandidate[] = [];
  for (const sentence of sentences) {
    // Greetings split into sentences are also skipped.
    if (isGreeting(sentence)) continue;

    let type: MemoryType = "fact";
    let retention: RetentionClass = "volatile";
    for (const { type: t, patterns, retention: r } of MEMORY_TYPES) {
      if (patterns.some((p) => p.test(sentence))) { type = t; retention = r; break; }
    }

    // Identity facts: "I am X", "My name is X", "I am called X" → stable
    // These are permanent user identity — never fade, only correct.
    if (/^\s*(i\s+am|my\s+name\s+is|i\s+am\s+called|call\s+me)\b/i.test(sentence)) {
      type = "fact";
      retention = "stable";
    }

    // Denial/agent-response memories: "I do not have", "I have no record of" → ephemeral
    // These are not facts — they are observations of the agent's state.
    if (/^\s*(i\s+do\s+not\s+have|i\s+have\s+no\s+record|i\s+don't\s+know|i\s+do\s+not\s+know)\b/i.test(sentence)) {
      type = "observation";
      retention = "ephemeral";
    }

    const kw = keywordsFor(sentence);
    const cand: MemoryCandidate = {
      type,
      content: sentence,
      summary: sentence.length > 140 ? sentence.slice(0, 140) + "…" : sentence,
      concepts: [],
      keywords: kw,
      tags: [],
      entities: [],
      evidence: { quote: sentence, kind: "explicit" },
      confidence: 0.85,
      importance: importanceFor(type, retention),
      retentionClass: retention,
    };
    candidates.push(cand);
  }
  return candidates;
}

function importanceFor(t: MemoryType, retention?: RetentionClass): number {
  // Identity facts are stable and high importance
  if (retention === "stable") {
    switch (t) {
      case "preference": return 0.95;
      case "decision": return 0.9;
      case "goal": return 0.8;
      case "procedure": return 0.75;
      case "fact": return 0.85; // identity / core facts
      default: return 0.8;
    }
  }
  if (retention === "ephemeral") return 0.2;
  switch (t) {
    case "preference": return 0.95;
    case "decision": return 0.9;
    case "goal": return 0.8;
    case "fact": return 0.7;
    case "concept": return 0.6;
    case "event": return 0.6;
    case "procedure": return 0.5;
    case "observation": return 0.4;
    case "sensor": return 0.45;
    case "trajectory": return 0.5;
    case "hypothesis": return 0.6;
    case "experiment": return 0.65;
    default: return 0.5;
  }
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "of", "in", "on",
  "at", "to", "for", "with", "by", "from", "into", "is", "are", "was", "were",
  "be", "been", "i", "we", "you", "it", "this", "that", "these", "those",
  "what", "when", "where", "who", "how", "why", "what's", "it's", "i'm",
  "we're", "you're", "don't", "doesn't", "didn't", "isn't", "can't", "won't",
  "will", "would", "can", "could", "should", "must", "have", "has", "had",
  "do", "does", "did", "make", "made", "get", "got", "use", "used", "using",
  "my", "our", "your", "his", "her", "their", "me", "us", "him", "them",
]);

export function keywordsFor(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 10) break;
  }
  return out;
}

export function extract(experience: Experience): MemoryCandidate[] {
  return extractCandidates(experience.content);
}
