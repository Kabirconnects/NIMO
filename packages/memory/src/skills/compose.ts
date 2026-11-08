// skills/compose.ts
// Skill composition — chunking repeated sequences into one macro-skill,
// like the brain chunking "read error → patch → test" into one neuron.
// Two skills compose when they share keywords and both are confident.

import type { Skill } from "../domain/skill.types.js";

export interface ComposeCandidate { a: Skill; b: Skill; overlap: number; chunkedSteps: string[]; }

export function findComposeCandidates(skills: Skill[], threshold = 0.6): ComposeCandidate[] {
  const actives = skills.filter((s) => s.status === "active" && s.confidence >= 0.6);
  const out: ComposeCandidate[] = [];
  for (let i = 0; i < actives.length; i++) {
    for (let j = i + 1; j < actives.length; j++) {
      const a = actives[i]!;
      const b = actives[j]!;
      const setA = new Set(a.keywords.map((k) => k.toLowerCase()));
      const setB = new Set(b.keywords.map((k) => k.toLowerCase()));
      const union = new Set([...setA, ...setB]);
      const overlap = union.size === 0 ? 0 : [...setA].filter((k) => setB.has(k)).length / union.size;
      if (overlap >= threshold) {
        out.push({
          a, b, overlap,
          chunkedSteps: [...a.steps, ...b.steps],
        });
      }
    }
  }
  return out;
}
