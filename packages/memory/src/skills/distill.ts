// skills/distill.ts
// Autonomous skill creation: when a gap is noticed (an experience has no
// loaded skill, or a skill failed), turn the experience into a candidate
// skill so next time the agent starts smarter. This is how the toddler
// learns by doing — no human has to teach each lesson.

import type { Skill, CreateSkillInput } from "../domain/skill.types.js";

function keywordsFor(text: string): string[] {
  const STOP = new Set([
    "the","a","an","and","or","but","if","then","else","of","in","on","at","to","for","with","by","from","into","is","are","was","were","be","been","i","we","you","it","this","that","what","when","where","who","how","why","will","would","can","could","should","must","have","has","had","do","does","did","make","made","get","got","use","used","using","my","our","your","his","her","their","me","us","him","them",
  ]);
  const words = text.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 8) break;
  }
  return out;
}

/** Turn one prompt/response/tool chain into a candidate skill. */
export function distillSkill(input: {
  ownerId: string;
  prompt: string;
  response: string;
  toolsUsed: string[];
}): CreateSkillInput | null {
  const prompt = input.prompt.trim();
  const response = (input.response ?? "").trim();
  if (!prompt || !response) return null;
  if (prompt.length < 12) return null; // too short to be a real gap

  const name = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join("-") || "learned";
  const steps = response
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*\d.)\s]+/, ""))
    .filter((l) => l.length > 3)
    .slice(0, 6);
  if (steps.length < 2) return null; // not a chain yet

  return {
    ownerId: input.ownerId,
    name,
    whenToUse: prompt.length > 140 ? prompt.slice(0, 140) + "…" : prompt,
    steps,
    toolsUsed: input.toolsUsed,
    keywords: keywordsFor(prompt + " " + response),
    confidence: 0.35,
    importance: 0.6,
  };
}

/** Char n-gram semantic similarity, shared with the retriever. */
export { embedText, cosSim } from "../retrieval/embed.js";

/** Decide whether a skill should be promoted/demoted/archived by its track record. */
export function skillLifecycle(s: Skill): "promote" | "demote" | "archive" | "keep" {
  if (s.status === "candidate" && s.successCount >= 1) return "promote";
  if (s.status === "active" && s.failureCount >= 3 && s.successCount < s.failureCount) return "archive";
  if (s.status === "active" && s.successCount < s.failureCount && s.confidence < 0.4) return "demote";
  return "keep";
}
