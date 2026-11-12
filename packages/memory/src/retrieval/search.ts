// retrieval/search.ts
// Hybrid recall with RRF fusion: BM25 keyword, entity, embedding-cosine,
// optional FTS5, and graph activation — independent rankings fused by RRF
// (k=60). The brain fires by *gist* (meaning), not exact words.
//
// Retrieval is READ-ONLY and deterministic:
//   - no edge/confidence/degree writes happen here
//   - noise queries (no lexical hit and no gist match) return nothing
//   - scan caps and result truncation are reported, never hidden

import type { RecallInput, RecallResult, RetrievedMemory } from "../domain/service.types.js";
import type { MemoryNode } from "../domain/memory.types.js";
import { isRetrievable } from "../governance/policy.js";
import {
  countActiveMemories,
  listActiveMemoriesByImportance,
  listActiveSkills,
  isFtsAvailable,
  searchFts,
} from "../storage/db.js";
import { activate } from "./activate.js";
import { bm25Score, embedText, cosSim, stemsOverlap, isCommonWord } from "./embed.js";
import { rrf } from "./rrf.js";
import { computeFinalScore } from "./rank.js";

/** Hard scan cap. Reported through `poolTruncated` when exceeded. */
const SCAN_CAP = 5000;
/** Embedding cosine that counts as a genuine gist match (with token evidence). */
const GIST_MIN = 0.22;
/** Very strong cosine can stand alone, without any shared token. */
const STRONG_GIST = 0.45;
/** Never surface a result with essentially no relationship to the query. */
const MIN_RELEVANCE = 0.08;

const QUERY_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "by", "for",
  "with", "from", "is", "are", "was", "were", "be", "been", "being", "it",
  "this", "that", "these", "those", "i", "we", "you", "he", "she", "they",
  "my", "our", "your", "their", "me", "us", "them", "do", "does", "did",
  "have", "has", "had", "what", "which", "who", "whom", "when", "where",
  "why", "how", "about", "please", "tell", "me", "can", "could", "would",
  "should", "is", "there", "here",
]);

function queryTerms(query: string): string[] {
  const all = query
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
  const meaningful = all.filter((t) => !QUERY_STOPWORDS.has(t));
  return [...new Set(meaningful.length > 0 ? meaningful : all)];
}

function nodeEmbedding(node: MemoryNode): number[] {
  if (node.embedding && node.embedding.length > 0) return node.embedding;
  return embedText([node.content, node.summary, ...node.keywords].join(" "));
}

/** At least one query content word shares a stem with the memory text. */
function hasTokenEvidence(terms: string[], haystack: string): boolean {
  const words = (haystack.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
    .filter((w) => w.length >= 3 && !isCommonWord(w));
  for (const t of terms) {
    for (const w of words) {
      if (stemsOverlap(t, w)) return true;
    }
  }
  return false;
}

export function recall(input: RecallInput): RecallResult {
  const started = Date.now();
  const limit = Math.max(1, input.limit ?? 10);

  // Human-like flowing pool: one continuous stream of active memories, no
  // session buckets. Load the most important memories first so an old stable
  // fact cannot be cut off by a wall of fresh filler.
  const totalActive = countActiveMemories(input.ownerId);
  const actives = listActiveMemoriesByImportance(input.ownerId, SCAN_CAP);
  const poolTruncated = totalActive > actives.length;

  const terms = queryTerms(input.query);

  const empty = (): RecallResult => ({
    memories: [],
    totalCandidates: 0,
    totalActive,
    scannedCandidates: actives.length,
    poolTruncated,
    resultsTruncated: false,
    queryConcepts: terms,
    retrievalTimeMs: Date.now() - started,
  });

  if (terms.length === 0) return empty();

  const queryEmb = embedText(input.query);
  const byId = new Map(actives.map((a) => [a.id, a]));

  const bm25 = new Map<string, number>();
  const cos = new Map<string, number>();
  const entityMatches = new Set<string>();
  const ftsIds = isFtsAvailable() ? searchFts(input.ownerId, input.query, 200) : [];
  const ftsSet = new Set(ftsIds);

  for (const node of actives) {
    if (!isRetrievable(node, input.ownerId)) continue;
    if (input.memoryTypes?.length && !input.memoryTypes.includes(node.type)) continue;

    const haystack = [node.content, node.summary, ...node.concepts, ...node.keywords, ...node.tags].join(" ");
    const bm = bm25Score(terms, haystack);
    if (bm > 0) bm25.set(node.id, bm);

    const entityNames = node.entities.map((e) => e.name.toLowerCase());
    if (entityNames.some((n) => terms.some((t) => n.includes(t)))) {
      entityMatches.add(node.id);
    }

    const c = cosSim(queryEmb, nodeEmbedding(node));
    if (c > 0.02) cos.set(node.id, c);
  }

  // Noise gate: a memory must have a lexical hit, an entity hit, an FTS hit,
  // or a gist match backed by at least one shared content stem. A cosine
  // alone above STRONG_GIST is also accepted. Nonsense queries therefore
  // return nothing instead of a confidently-scored unrelated memory.
  const candidateIds = new Set<string>();
  for (const node of actives) {
    if (input.memoryTypes?.length && !input.memoryTypes.includes(node.type)) continue;
    const haystack = [node.content, node.summary, ...node.concepts, ...node.keywords, ...node.tags].join(" ");
    const gist = cos.get(node.id) ?? 0;
    const lexical =
      (bm25.get(node.id) ?? 0) > 0 ||
      entityMatches.has(node.id) ||
      ftsSet.has(node.id);
    const gistOk =
      gist >= STRONG_GIST ||
      (gist >= GIST_MIN && hasTokenEvidence(terms, haystack));
    if (lexical || gistOk) candidateIds.add(node.id);
  }
  const candidateNodes = actives.filter((n) => candidateIds.has(n.id));
  if (candidateNodes.length === 0) {
    // Skills are knowledge too. A procedure can match the query even when no
    // stored memory does, so do not return empty before projecting them.
    const skillOnly = projectSkills(input.ownerId, input.query, terms, byId);
    if (skillOnly.length === 0) return empty();
    skillOnly.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.memory.id.localeCompare(b.memory.id);
    });
    return {
      memories: skillOnly.slice(0, limit),
      totalCandidates: 0,
      totalActive,
      scannedCandidates: actives.length,
      poolTruncated,
      resultsTruncated: skillOnly.length > limit,
      queryConcepts: terms,
      retrievalTimeMs: Date.now() - started,
    };
  }

  const sortedIds = (ids: string[], scoreOf: (id: string) => number) =>
    [...ids].sort((a, b) => {
      const d = scoreOf(b) - scoreOf(a);
      if (d !== 0) return d;
      const na = byId.get(a)!;
      const nb = byId.get(b)!;
      return nb.updatedAt.getTime() - na.updatedAt.getTime() || a.localeCompare(b);
    });

  const bm25Rank = sortedIds([...bm25.keys()].filter((id) => candidateIds.has(id)), (id) => bm25.get(id) ?? 0);
  const entityRank = sortedIds([...entityMatches].filter((id) => candidateIds.has(id)), () => 1);
  const embedRank = sortedIds([...cos.keys()].filter((id) => candidateIds.has(id)), (id) => cos.get(id) ?? 0);
  const ftsRank = ftsIds.filter((id) => byId.has(id) && candidateIds.has(id));
  const fusedIds = rrf([bm25Rank, entityRank, embedRank, ftsRank].filter((l) => l.length > 0));

  const scored: RetrievedMemory[] = [];
  for (const id of fusedIds) {
    const node = byId.get(id);
    if (!node || !isRetrievable(node, input.ownerId)) continue;

    const haystack = [node.content, node.summary, ...node.concepts, ...node.keywords, ...node.tags]
      .join(" ")
      .toLowerCase();
    let hits = 0;
    for (const t of terms) if (haystack.includes(t)) hits++;

    const bm = bm25.get(id) ?? 0;
    const c = cos.get(id) ?? 0;
    const coverage = hits / Math.max(1, terms.length);
    const bmNorm = bm > 0 ? Math.min(1, bm / (bm + 1)) : 0;
    const relevance = Math.max(
      coverage,
      bmNorm,
      c >= GIST_MIN ? c : 0,
      entityMatches.has(id) ? 0.5 : 0,
    );
    if (relevance < MIN_RELEVANCE && !entityMatches.has(id)) continue;

    const matchedBy: RetrievedMemory["matchedBy"] = [];
    if (hits > 0 || bm > 0) matchedBy.push("keyword");
    if (entityMatches.has(id)) matchedBy.push("entity");
    if (c >= GIST_MIN) matchedBy.push("vector");
    if (matchedBy.length === 0) matchedBy.push("keyword");

    scored.push({
      memory: node,
      score: computeFinalScore(node, relevance),
      matchedBy,
      relatedMemoryIds: [],
      evidence: input.includeEvidence ? node.evidence : [],
    });
  }
  if (scored.length === 0) return empty();

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tb = b.memory.updatedAt.getTime();
    const ta = a.memory.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    return a.memory.id.localeCompare(b.memory.id);
  });
  const seeds = scored.slice(0, Math.max(limit, 10));

  // The brain part: spread activation along synapses from the seeds so
  // connected memories (even with zero keyword overlap) can surface.
  const expanded = activate(input.ownerId, seeds, input.maxGraphHops ?? 2);

  // Skills are knowledge too — project active skills into the same stream.
  const skillProjections = projectSkills(input.ownerId, input.query, terms, byId);
  for (const proj of skillProjections) {
    if (!expanded.some((e) => e.memory.id === proj.memory.id)) {
      expanded.push(proj);
    }
  }

  const rankedAll = [...expanded].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const tb = b.memory.updatedAt.getTime();
    const ta = a.memory.updatedAt.getTime();
    if (tb !== ta) return tb - ta;
    return a.memory.id.localeCompare(b.memory.id);
  });
  const resultsTruncated = rankedAll.length > limit;
  const ranked = rankedAll.slice(0, limit);

  return {
    memories: ranked,
    totalCandidates: candidateNodes.length,
    totalActive,
    scannedCandidates: actives.length,
    poolTruncated,
    resultsTruncated,
    queryConcepts: terms,
    retrievalTimeMs: Date.now() - started,
  };
}

/**
 * Project active skills that match the query into RetrievedMemory so a
 * single recall() call returns both facts and procedures.
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
    const hayWords = (hay.match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length >= 3 && !isCommonWord(w));
    let hits = 0;
    for (const t of terms) {
      if (hayWords.some((w) => w.length >= 3 && stemsOverlap(t, w))) hits++;
    }
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

  out.sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
  return out.slice(0, 10);
}
