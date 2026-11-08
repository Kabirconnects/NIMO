// retrieval/assemble.ts
// Turn retrieved memories into compact prompt context. Never dump the whole
// graph: fetch a small top-K with evidence excerpts and a token budget.

import type { MemoryContext } from "../domain/service.types.js";
import type { RetrievedMemory } from "../domain/service.types.js";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildMemoryContext(memories: RetrievedMemory[]): MemoryContext {
  const formattedContext = memories
    .map(({ memory, evidence }) =>
      [
        `Memory: ${memory.summary}`,
        `Type: ${memory.type}`,
        `Confidence: ${memory.confidence}`,
        `Evidence: ${evidence.map((e) => e.quote).filter(Boolean).join("; ")}`,
      ].join("\n"),
    )
    .join("\n\n");

  return {
    memories,
    formattedContext,
    tokenEstimate: estimateTokens(formattedContext),
  };
}
