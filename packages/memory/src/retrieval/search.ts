// retrieval/search.ts
// Hybrid recall with RRF fusion: BM25 keyword, entity, embedding-cosine,
// graph activation — 4 independent rankings fused by RRF (k=60).
// The brain fires by *gist* (meaning), not exact words, and newest-first.

import type { RecallInput, RecallResult, RetrievedMemory } from "../domain/service.types.js";
import { isRetrievable } from "../governance/policy.js";
import { listActiveMemories, listActiveSkills } from "../storage/db.js";
import { activate } from "./activate.js";
import { bm25Score, embedText, cosSim } from "./embed.js";
import { rrf } from "./rrf.js";
import { computeFinalScore } from "./rank.js";
import type { MemoryNode } from "../domain/memory.types.js";

export function recall(input: RecallInput): RecallResult {
  const started = Date.now();
  const limit = input.limit ?? 10;

  // Human-like flowing pool: one continuous stream of active memories,
  // no session buckets. Order is now by multi-factor score (A-MEM + HippoRAG),
  // not pure recency. Load ALL active memories — the 200-limit was why
  // important old memories were invisible.
  const actives = listActiveMemories(input.ownerId, { limit: 5000 });

  const terms = input.query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3);

  const queryEmb = embedText(input.query);
  const byId = new Map(actives.map((a) => [a.id, a]));
  const bm25Ids: string[] = [];
  const entityIds: string[] = [];
  const embedIds: string[] = [];

  for (const node of actives) {
    if (!isRetrievable(node, input.ownerId)) continue;
    if (input.memoryTypes?.length && !input.memoryTypes.includes(node.type)) continue;

    const haystack = [node.content, node.summary, ...node.concepts, ...node.keywords, ...node.tags].join(" ");
    if (bm25Score(terms, haystack) > 0) bm25Ids.push(node.id);
    if (node.entities.some((e) => terms.some((t) => e.name.toLowerCase().includes(t)))) entityIds.push(node.id);
    const emb = embedText([node.content, node.summary, ...node.keywords].join(" "));
    if (cosSim(queryEmb, emb) > 0.05) embedIds.push(node.id);
  }

  const rankWith = (ids: string[], scoreFn: (n: (typeof actives)[number]) => number) =>
    ids
      .map((id) => byId.get(id)!)
      .filter(Boolean)
      .sort((a, b) => scoreFn(b) - scoreFn(a) || b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((n) => n.id);

  const bm25Rank = rankWith(bm25Ids, (n) => bm25Score(terms, n.content + " " + n.summary));
  const entityRank = rankWith(entityIds, () => 1);
  const embedRank = rankWith(embedIds, (n) => cosSim(queryEmb, embedText(n.content + " " + n.summary)));

  const fusedIds = rrf([bm25Rank, entityRank, embedRank]);
  // Diffusion threshold: embedding cosine > 0.15 counts as "gist" match so
  // morphological/semantic relatives fire even without exact words.
  const fusedSet = new Set(fusedIds.filter((id) => {
    const n = byId.get(id)!;
    const emb = embedText([n.content, n.summary, ...n.keywords].join(" "));
    return cosSim(queryEmb, emb) > 0.15 || bm25Ids.includes(id);
  }));

  const scored: RetrievedMemory[] = [];
  for (const node of actives) {
    if (!isRetrievable(node, input.ownerId)) continue;
    if (input.memoryTypes?.length && !input.memoryTypes.includes(node.type)) continue;
    if (!fusedSet.has(node.id)) continue;

    const haystack = [node.content, node.summary, ...node.concepts, ...node.keywords, ...node.tags]
      .join(" ")
      .toLowerCase();

    let hits = 0;
    for (const t of terms) if (haystack.includes(t)) hits++;
    const matchedBy: RetrievedMemory["matchedBy"] = ["keyword"];
    const entityNames = node.entities.map((e) => e.name.toLowerCase());
    if (entityNames.some((n) => terms.some((t) => n.includes(t)))) matchedBy.push("entity");
    if (bm25Ids.includes(node.id)) matchedBy.push("keyword");

    const relevance = Math.max(
        hits / Math.max(1, terms.length),
        bm25Score(terms, haystack) > 0 ? 0.3 : 0,
        cosSim(queryEmb, embedText([node.content, node.summary].join(" "))) > 0.05 ? 0.2 : 0,
      );
    const finalScore = computeFinalScore(node, relevance);

    scored.push({
      memory: node,
      score: finalScore,
      matchedBy,
      relatedMemoryIds: [],
      evidence: input.includeEvidence ? node.evidence : [],
    });
  }

  // Sort by multi-factor score (importance + graph centrality + PageRank + relevance + recency).
  // Recency is now weight 0.15 in the score, not the primary sort key.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tb = b.memory.updatedAt.getTime();
    const ta = a.memory.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    return b.memory.importance - a.memory.importance;
  });
  const seeds = scored.slice(0, Math.max(limit, 10));

  // The brain part: spread activation along synapses from the seeds so
  // connected memories (even with zero keyword overlap) can surface.
  const expanded = activate(input.ownerId, seeds, input.maxGraphHops ?? 2);

  // Skills silo fix: a skill ("fix-bug") is knowledge too — it must be
  // recallable by the same query path as a fact. Without this, "How do I
  // fix a failing test?" finds no skill even when one is active.
  // Project active skills into the same ranked stream as memories.
  const skillProjections = projectSkills(input.ownerId, input.query, terms, byId);
  for (const proj of skillProjections) {
    if (!expanded.some((e) => e.memory.id === proj.memory.id)) {
      expanded.push(proj);
    }
  }

  // Final surface order: multi-factor score (not pure recency).
  const ranked = [...expanded].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tb = b.memory.updatedAt.getTime();
    const ta = a.memory.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    return b.memory.importance - a.memory.importance;
  }).slice(0, limit);

  return {
    memories: ranked,
    totalCandidates: actives.length + skillProjections.length,
    queryConcepts: terms,
    retrievalTimeMs: Date.now() - started,
  };
}

/**
 * Project active skills that match the query into RetrievedMemory so a
 * single recall() call returns both facts and procedures. Scoring mirrors
 * loadSkills() + the multi-factor formula: hit rate × 0.6 + success rate
 * × 0.25 × ageFactor + confidence × 0.15, then blended with the existing
 * final-score scale so skills compete fairly with memories.
 */
function projectSkills(
  ownerId: string,
  _query: string,
  terms: string[],
  _byId: Map<string, MemoryNode>,
): RetrievedMemory[] {
  if (terms.length === 0) return [];
  const skills = listActiveSkills(ownerId, 200);
  const out: RetrievedMemory[] = [];

  for (const s of skills) {
    const hay = [s.name, s.whenToUse, ...s.keywords, ...s.tags, ...s.steps].join(" ").toLowerCase();
    let hits = 0;
    for (const t of terms) if (hay.includes(t)) hits++;
    if (hits === 0) continue;

    const last = s.lastAccessedAt?.getTime() ?? s.updatedAt.getTime();
    const ageFactor = 1 / (1 + (Date.now() - last) / (30 * 24 * 60 * 60 * 1000));
    const successRate = s.useCount > 0 ? s.successCount / s.useCount : 0.5;
    const skillScore = (hits / Math.max(1, terms.length)) * 0.6 + successRate * 0.25 * ageFactor + s.confidence * 0.15;

    // Materialize as a memory-like node so downstream code (context
    // builder, benchmark content match) treats it uniformly. stable
    // retention: a proven procedure is durable knowledge.
    const node: MemoryNode = {
      id: s.id,
      ownerId: s.ownerId,
      type: "procedure",
      status: "active",
      visibility: "private",
      content: `Skill "${s.name}": ${s.whenToUse}. Steps: ${s.steps.join(" → ")}`,
      summary: s.whenToUse,
      concepts: [],
      keywords: [...s.keywords],
      tags: [...s.tags, "skill", s.name],
      entities: [],
      confidence: s.confidence,
      importance: Math.max(s.importance, 0.7), // proven skills are valuable
      retentionClass: "stable",
      graphDegree: 0,
      pageRank: 0,
      evidence: [],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastAccessedAt: s.lastAccessedAt,
    };
    // Relevance is the skill hit rate; fold it into the shared formula.
    const score = computeFinalScore(node, hits / Math.max(1, terms.length)) + skillScore * 0.1;

    out.push({
      memory: node,
      score,
      matchedBy: ["keyword"],
      relatedMemoryIds: [],
      evidence: [],
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 10);
}
