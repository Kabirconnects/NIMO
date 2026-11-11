// ingestion/extract.ts
// Stage 2: extract MemoryCandidate[] from an experience. Rule-based (regex +
// heuristics), no LLM — deterministic, fast, and testable. Candidates are
// validated by ingestion/validate.ts before any write.
//
// Speech-act awareness:
//   - questions and instructions are NOT durable facts
//   - assistant/system text never becomes a user fact (assistant output is
//     not independent evidence)
//   - tool/document evidence is labelled and carries lower confidence
//   - hedged claims ("maybe", "I think") are inferred, not explicit

import type { Experience } from "../domain/experience.types.js";
import type { MemoryCandidate, MemoryType, RetentionClass, EvidenceKind } from "../domain/memory.types.js";

const GREETINGS = new Set([
  "hi", "hello", "hey", "yo", "namaste", "good morning", "good evening",
  "good afternoon", "what's up", "whats up", "sup", "hola", "bye", "goodbye",
]);

export function isGreeting(content: string): boolean {
  const t = content.toLowerCase().replace(/[.!?,]+$/g, "").trim();
  return GREETINGS.has(t);
}

/** Who produced this text. Source decides whether facts may be extracted. */
export type SpeakerRole = "user" | "assistant" | "tool" | "system" | "document";

export interface ExtractOptions {
  role?: SpeakerRole;
}

const QUESTION_START_RE =
  /^\s*(what|who|where|when|why|how|which|whose)\b[\s\S]*\b(is|are|was|were|do|does|did|can|could|would|should|will|has|have|had)\b/i;
const QUESTION_END_RE = /\?\s*$/;
const INSTRUCTION_START_RE =
  /^\s*(?:please\b|can you\b|could you\b|would you\b|will you\b|you (?:should|must|need to|have to|are|were|can)\b|i (?:want|need) you to\b|(?:write|run|find|show|explain|summarize|give|tell|list|create|delete|remove|fix|add|update|install|configure|start|stop|deploy|search|look up|make|build|generate|refactor|test|check)\b)/i;
const HEDGE_RE =
  /\b(?:maybe|perhaps|probably|possibly|might|may|i think|i guess|not sure|seems|appears|likely|unclear|around|approximately)\b/i;

export function isQuestion(content: string): boolean {
  return QUESTION_END_RE.test(content) || QUESTION_START_RE.test(content);
}

export function isInstruction(content: string): boolean {
  return INSTRUCTION_START_RE.test(content);
}

/** Assistant/system output is not independent evidence about the user/world. */
function isNonEvidential(role: SpeakerRole | undefined): boolean {
  return role === "assistant" || role === "system";
}

function evidenceFor(
  sentence: string,
  role: SpeakerRole | undefined,
): { kind: EvidenceKind; confidence: number } {
  if (role === "tool") return { kind: "tool_result", confidence: 0.55 };
  if (role === "document") return { kind: "observed", confidence: 0.7 };
  if (HEDGE_RE.test(sentence)) return { kind: "inferred", confidence: 0.4 };
  return { kind: "explicit", confidence: 0.85 };
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
      /\b(fixed|broke|resolved|shipped|deployed|released|merged|renamed|deleted|created|added|removed)\b/i,
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

/** Extract one candidate per sentence (or the whole message if one line). */
export function extractCandidates(
  content: string,
  options: ExtractOptions = {},
): MemoryCandidate[] {
  const text = content.trim();
  if (!text) return [];

  // Assistant/system output is recorded as an experience but never mined for
  // facts: the agent's own words are not independent evidence.
  if (isNonEvidential(options.role)) return [];

  // Greetings are conversation glue, not durable memories — capture the
  // experience (context) but don't form a neuron from it.
  if (isGreeting(text)) return [];

  // Structured data / code block / JSON expansion
  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]")) ||
    text.includes("```")
  ) {
    const type: MemoryType = text.includes("```") ? "procedure" : "concept";
    const kw = keywordsFor(text);
    const ev = evidenceFor(text, options.role);
    return [{
      type,
      content: text,
      summary: text.length > 140 ? text.slice(0, 140) + "…" : text,
      concepts: ["structured-data", type],
      keywords: kw.length > 0 ? kw : ["structured", "data"],
      tags: ["structured", "schema-or-code"],
      entities: [],
      evidence: { quote: text.slice(0, 200), kind: ev.kind },
      confidence: ev.confidence,
      importance: 0.85,
      retentionClass: "stable",
    }];
  }

  const sentences: string[] = [];
  for (const part of text.split(/\r?\n/)) {
    const line = part.trim();
    if (!line) continue;
    const sents = line.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    for (const s of sents) sentences.push(s);
  }

  const candidates: MemoryCandidate[] = [];
  for (const sentence of sentences) {
    if (isGreeting(sentence)) continue;

    // Speech-act gate: a question or a command is not a belief.
    if (isQuestion(sentence) || isInstruction(sentence)) continue;

    let type: MemoryType = "fact";
    let retention: RetentionClass = "volatile";
    for (const { type: t, patterns, retention: r } of MEMORY_TYPES) {
      if (patterns.some((p) => p.test(sentence))) { type = t; retention = r; break; }
    }

    // Identity facts: "I am X", "My name is X", "I am called X" → stable.
    if (/^\s*(i\s+am|my\s+name\s+is|i\s+am\s+called|call\s+me)\b/i.test(sentence)) {
      type = "fact";
      retention = "stable";
    }

    // Denial/agent-response memories stay as ephemeral observations so the
    // validation layer can reject them explicitly (they are never facts).
    if (/^\s*(i\s+do\s+not\s+have|i\s+have\s+no\s+record|i\s+don't\s+know|i\s+do\s+not\s+know)\b/i.test(sentence)) {
      type = "observation";
      retention = "ephemeral";
    }

    const ev = evidenceFor(sentence, options.role);
    const kw = keywordsFor(sentence);
    const cand: MemoryCandidate = {
      type,
      content: sentence,
      summary: sentence.length > 140 ? sentence.slice(0, 140) + "…" : sentence,
      concepts: [],
      keywords: kw,
      tags: options.role ? [`role:${options.role}`] : [],
      entities: [],
      evidence: { quote: sentence, kind: ev.kind },
      confidence: ev.confidence,
      importance: importanceFor(type, retention, ev.kind),
      retentionClass: retention,
    };
    candidates.push(cand);
  }
  return candidates;
}

function importanceFor(t: MemoryType, retention?: RetentionClass, kind?: EvidenceKind): number {
  // Tool/document evidence is useful but never treated as first-hand truth.
  const uncertaintyPenalty = kind === "inferred" ? 0.7 : kind === "tool_result" ? 0.85 : 1;

  if (retention === "stable") {
    const base = (() => {
      switch (t) {
        case "preference": return 0.95;
        case "decision": return 0.9;
        case "goal": return 0.8;
        case "procedure": return 0.75;
        case "fact": return 0.85; // identity / core facts
        default: return 0.8;
      }
    })();
    return Math.round(base * uncertaintyPenalty * 100) / 100;
  }
  if (retention === "ephemeral") return 0.2;
  const base = (() => {
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
  })();
  return Math.round(base * uncertaintyPenalty * 100) / 100;
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

/** Map an experience type to a speaker role when the caller did not specify. */
export function roleForExperience(type: Experience["type"]): SpeakerRole {
  switch (type) {
    case "tool_call":
    case "tool_result":
      return "tool";
    case "system_observation":
      return "system";
    case "external_document":
      return "document";
    case "message":
    default:
      return "user";
  }
}

export function extract(experience: Experience, options: ExtractOptions = {}): MemoryCandidate[] {
  return extractCandidates(
    experience.content,
    { role: options.role ?? roleForExperience(experience.type) },
  );
}
