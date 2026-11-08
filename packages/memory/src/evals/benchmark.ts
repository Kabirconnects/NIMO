// evals/benchmark.ts
// Stage 7: retrieval benchmark harness.
// Compares three retrieval configurations on a fixed question set:
//   1. Vector-only (embedding cosine top-K)
//   2. Vector + keyword + entity (3 signals)
//   3. Hybrid + graph (RRF + spreading activation, current production)
//
// Metrics: Recall@K, Precision@K, MRR, latency, faithfulness (evidence present)
// Test categories: direct, cross-session, semantic, multi-hop, temporal,
//   contradiction, correction, negative, forgetting, isolation
//
// Research basis: HippoRAG (NeurIPS 2024) multi-hop retrieval benchmark,
//   A-MEM (NeurIPS 2025) dynamic memory evaluation, AgeMem (ACL 2026) tool-based recall.

import type { RecallInput, RecallResult } from "../domain/service.types.js";
import { recall } from "../retrieval/search.js";
import { embedText, cosSim } from "../retrieval/embed.js";
import { listActiveMemories } from "../storage/db.js";
import { isRetrievable } from "../governance/policy.js";

export interface BenchmarkQuestion {
  id: string;
  query: string;
  category: "direct" | "cross-session" | "semantic" | "multi-hop" | "temporal" | "contradiction" | "correction" | "negative" | "forgetting" | "isolation";
  expectedMemoryIds: string[]; // ids that should appear in top-K
  expectedAbsentIds?: string[]; // ids that must NOT appear (negative, forgetting, isolation)
}

export interface BenchmarkResult {
  questionId: string;
  query: string;
  category: BenchmarkQuestion["category"];
  config: "vector-only" | "vector-keyword-entity" | "hybrid-graph";
  recallAtK: number;      // fraction of expected found
  precisionAtK: number;   // fraction of retrieved that are expected
  mrr: number;            // 1/rank of first correct (0 if none)
  latencyMs: number;
  faithfulness: number;   // fraction with evidence present (0-1)
  totalRetrieved: number;
}

export interface BenchmarkSummary {
  config: string;
  meanRecall: number;
  meanPrecision: number;
  meanMRR: number;
  meanLatencyMs: number;
  meanFaithfulness: number;
  totalQuestions: number;
  perCategory: Record<string, { recall: number; precision: number; mrr: number; count: number }>;
}

/** Build vector-only recall (embedding cosine only) for baseline comparison. */
function recallVectorOnly(ownerId: string, query: string, limit: number): { ids: string[]; scores: Map<string, number> } {
  const actives = listActiveMemories(ownerId, { limit: 200 });
  const queryEmb = embedText(query);
  const scored: { id: string; score: number }[] = [];

  for (const node of actives) {
    if (!isRetrievable(node, ownerId)) continue;
    const emb = embedText([node.content, node.summary, ...node.keywords].join(" "));
    const score = cosSim(queryEmb, emb);
    if (score > 0.05) scored.push({ id: node.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    ids: scored.slice(0, limit).map((s) => s.id),
    scores: new Map(scored.map((s) => [s.id, s.score])),
  };
}

/** Build vector+keyword+entity recall (hybrid without graph). */
function recallHybridNoGraph(ownerId: string, query: string, limit: number): { ids: string[]; scores: Map<string, number> } {
  // Use production recall with maxGraphHops=0 to disable graph expansion
  const result = recall({ ownerId, query, limit, maxGraphHops: 0, includeEvidence: true });
  return {
    ids: result.memories.map((r) => r.memory.id),
    scores: new Map(result.memories.map((r) => [r.memory.id, r.score])),
  };
}

/** Production hybrid+graph recall. */
function recallHybridGraph(ownerId: string, query: string, limit: number): { ids: string[]; scores: Map<string, number> } {
  const result = recall({ ownerId, query, limit, maxGraphHops: 2, includeEvidence: true });
  return {
    ids: result.memories.map((r) => r.memory.id),
    scores: new Map(result.memories.map((r) => [r.memory.id, r.score])),
  };
}

function computeMetrics(
  retrievedIds: string[],
  expectedIds: string[],
  absentIds: string[] | undefined,
  latencyMs: number,
  evidencePresent: boolean[],
): { recallAtK: number; precisionAtK: number; mrr: number; faithfulness: number } {
  if (expectedIds.length === 0) {
    return { recallAtK: 1, precisionAtK: 1, mrr: 1, faithfulness: 1 };
  }
  const found = expectedIds.filter((id) => retrievedIds.includes(id));
  const recallAtK = found.length / expectedIds.length;
  const precisionAtK = retrievedIds.length > 0
    ? retrievedIds.filter((id) => expectedIds.includes(id)).length / retrievedIds.length
    : 0;

  let mrr = 0;
  for (let i = 0; i < retrievedIds.length; i++) {
    if (expectedIds.includes(retrievedIds[i]!)) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  const faithfulness = evidencePresent.length > 0
    ? evidencePresent.filter(Boolean).length / evidencePresent.length
    : 0;

  // Penalty for absent ids appearing (negative/forgetting/isolation tests)
  if (absentIds?.length) {
    const leaked = absentIds.filter((id) => retrievedIds.includes(id));
    if (leaked.length > 0) {
      return { recallAtK: 0, precisionAtK: 0, mrr: 0, faithfulness: 0 };
    }
  }

  return { recallAtK, precisionAtK, mrr, faithfulness };
}

/**
 * Run the full benchmark comparing all three configurations.
 * Returns per-question results and summary statistics.
 */
export function runBenchmark(
  ownerId: string,
  questions: BenchmarkQuestion[],
  k = 8,
): { results: BenchmarkResult[]; summaries: Record<string, BenchmarkSummary> } {
  const configs: Record<string, (owner: string, query: string, limit: number) => { ids: string[]; scores: Map<string, number> }> = {
    "vector-only": recallVectorOnly,
    "vector-keyword-entity": recallHybridNoGraph,
    "hybrid-graph": recallHybridGraph,
  };

  const allResults: BenchmarkResult[] = [];

  for (const [configName, recallFn] of Object.entries(configs)) {
    for (const q of questions) {
      const start = Date.now();
      const { ids } = recallFn(ownerId, q.query, k);
      const latencyMs = Date.now() - start;

      // Faithfulness: check evidence presence (for hybrid configs)
      const evidencePresent: boolean[] = [];
      if (configName === "hybrid-graph" || configName === "vector-keyword-entity") {
        const fullResult = recall({ ownerId, query: q.query, limit: k, maxGraphHops: configName === "hybrid-graph" ? 2 : 0, includeEvidence: true });
        for (const r of fullResult.memories) {
          evidencePresent.push(r.evidence.length > 0 || r.memory.evidence.length > 0);
        }
      }

      const metrics = computeMetrics(ids, q.expectedMemoryIds, q.expectedAbsentIds, latencyMs, evidencePresent);

      allResults.push({
        questionId: q.id,
        query: q.query,
        category: q.category,
        config: configName as BenchmarkResult["config"],
        recallAtK: metrics.recallAtK,
        precisionAtK: metrics.precisionAtK,
        mrr: metrics.mrr,
        latencyMs,
        faithfulness: metrics.faithfulness,
        totalRetrieved: ids.length,
      });
    }
  }

  // Compute summaries
  const summaries: Record<string, BenchmarkSummary> = {};
  for (const configName of Object.keys(configs)) {
    const configResults = allResults.filter((r) => r.config === configName);
    const n = configResults.length;

    const byCategory: Record<string, { recall: number[]; precision: number[]; mrr: number[]; count: number }> = {};
    for (const r of configResults) {
      if (!byCategory[r.category]) byCategory[r.category] = { recall: [], precision: [], mrr: [], count: 0 };
      const cat = byCategory[r.category]!;
      cat.recall.push(r.recallAtK);
      cat.precision.push(r.precisionAtK);
      cat.mrr.push(r.mrr);
      cat.count++;
    }

    const perCategory: BenchmarkSummary["perCategory"] = {};
    for (const [cat, data] of Object.entries(byCategory)) {
      perCategory[cat] = {
        recall: data.recall.reduce((a, b) => a + b, 0) / data.recall.length,
        precision: data.precision.reduce((a, b) => a + b, 0) / data.precision.length,
        mrr: data.mrr.reduce((a, b) => a + b, 0) / data.mrr.length,
        count: data.count,
      };
    }

    summaries[configName] = {
      config: configName,
      meanRecall: configResults.reduce((s, r) => s + r.recallAtK, 0) / n,
      meanPrecision: configResults.reduce((s, r) => s + r.precisionAtK, 0) / n,
      meanMRR: configResults.reduce((s, r) => s + r.mrr, 0) / n,
      meanLatencyMs: configResults.reduce((s, r) => s + r.latencyMs, 0) / n,
      meanFaithfulness: configResults.reduce((s, r) => s + r.faithfulness, 0) / n,
      totalQuestions: n,
      perCategory,
    };
  }

  return { results: allResults, summaries };
}

/**
 * Format benchmark summaries as a readable report.
 */
export function formatBenchmarkReport(summaries: Record<string, BenchmarkSummary>): string {
  const lines = [
    "=== PAME Retrieval Benchmark (Stage 7) ===",
    "",
  ];

  for (const [config, summary] of Object.entries(summaries)) {
    lines.push(`Config: ${config}`);
    lines.push(`  Recall@${"K"}: ${(summary.meanRecall * 100).toFixed(1)}% | Precision: ${(summary.meanPrecision * 100).toFixed(1)}% | MRR: ${summary.meanMRR.toFixed(3)}`);
    lines.push(`  Latency: ${summary.meanLatencyMs.toFixed(1)}ms avg | Faithfulness: ${(summary.meanFaithfulness * 100).toFixed(1)}%`);
    lines.push(`  Questions: ${summary.totalQuestions}`);
    lines.push("");
    lines.push("  Per category:");
    for (const [cat, data] of Object.entries(summary.perCategory)) {
      lines.push(`    ${cat.padEnd(15)}: recall=${(data.recall * 100).toFixed(0)}% prec=${(data.precision * 100).toFixed(0)}% mrr=${data.mrr.toFixed(2)} (n=${data.count})`);
    }
    lines.push("");
  }

  lines.push("=== Comparison ===");
  const configs = Object.keys(summaries);
  if (configs.length >= 3) {
    const v = summaries["vector-only"]!;
    const h = summaries["vector-keyword-entity"]!;
    const g = summaries["hybrid-graph"]!;
    lines.push(`Vector-only         Recall: ${(v.meanRecall * 100).toFixed(1)}%, MRR: ${v.meanMRR.toFixed(3)}`);
    lines.push(`Vector+KW+Entity    Recall: ${(h.meanRecall * 100).toFixed(1)}%, MRR: ${h.meanMRR.toFixed(3)}`);
    lines.push(`Hybrid+Graph        Recall: ${(g.meanRecall * 100).toFixed(1)}%, MRR: ${g.meanMRR.toFixed(3)}`);
    lines.push("");
    const improvement = ((g.meanRecall - v.meanRecall) / Math.max(0.01, v.meanRecall)) * 100;
    lines.push(`Graph improvement over vector-only: ${improvement.toFixed(1)}%`);
    if (improvement > 10) lines.push("✅ Graph complexity justified by retrieval improvement.");
    else lines.push("⚠️  Graph improvement < 10% — consider whether graph expansion is worth latency for this corpus.");
  }

  return lines.join("\n");
}
