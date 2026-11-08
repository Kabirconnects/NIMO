// evals/universal-benchmark.ts
// Stage 7+: the "real researcher" benchmark suite.
//
// Tests PAME across 6 UNIVERSAL axes — not just retrieval.
// Each axis measures a different AGI capability. The point is to SHOW
// where we are bad, not just where we are good.
//
// Axes:
//   1. MEMORY    — long-term recall across sessions (LOCOMO-style)
//   2. RESEARCH  — cross-paper synthesis, contradiction, replication
//   3. CODING    — procedure recall (how to do a known task)
//   4. ROBOTICS  — sensor→trajectory→skill chain retrieval
//   5. ADAPTATION— when the world changes, does recall prefer the new reality?
//   6. FORGETTING— deleted things MUST NOT be recalled (trust axis)
//
// Research basis:
//   LOCOMO (2024) — long conversational memory, cross-session QA
//   HippoRAG (2024) — multi-hop graph retrieval, entity-anchored
//   A-MEM (2025) — dynamic memory evolution, forgetting by relevance
//   AgeMem (2026) — memory ops as agent actions
//   SWE-bench (2024) — coding task resolution (adapted: procedure recall)
//   GAIA (2023) — general assistant tasks (adapted: cross-domain)

import type { RecallInput } from "../domain/service.types.js";
import { recall } from "../retrieval/search.js";

export type FieldAxis = "memory" | "research" | "coding" | "robotics" | "adaptation" | "forgetting";

export interface AxisQuestion {
  axis: FieldAxis;
  id: string;
  query: string;
  /** Memory contents that MUST be in top-K. */
  expect: string[]; // matched by content substring, not id
  /** Memory contents that MUST NOT be in top-K (wrong/old/deleted). */
  absent?: string[];
  /** K for this question (default 8). */
  k?: number;
}

export interface AxisResult {
  axis: FieldAxis;
  id: string;
  query: string;
  recallAtK: number;
  precisionAtK: number;
  mrr: number;
  latencyMs: number;
  /** Did the stable/important memory beat the ephemeral/junk one? */
  beatJunk: boolean | null; // null = no junk in this question
  pass: boolean;
}

export interface AxisSummary {
  axis: FieldAxis;
  meanRecall: number;
  meanPrecision: number;
  meanMRR: number;
  meanLatencyMs: number;
  passRate: number;
  total: number;
  /** The bad news: which questions failed and why. */
  failures: { id: string; query: string; reason: string }[];
}

/** Run one axis question against production recall. */
export function runAxisQuestion(ownerId: string, q: AxisQuestion, k = 8): AxisResult {
  const limit = q.k ?? k;
  const start = Date.now();
  const result = recall({ ownerId, query: q.query, limit, maxGraphHops: 2, includeEvidence: true });
  const latencyMs = Date.now() - start;

  const contents = result.memories.map((r) => r.memory.content);
  const found = q.expect.filter((e) => contents.some((c) => c.includes(e)));
  const recallAtK = q.expect.length === 0 ? 1 : found.length / q.expect.length;
  const precisionAtK = contents.length === 0 ? 0
    : contents.filter((c) => q.expect.some((e) => c.includes(e))).length / contents.length;

  let mrr = 0;
  for (let i = 0; i < contents.length; i++) {
    if (q.expect.some((e) => contents[i]!.includes(e))) { mrr = 1 / (i + 1); break; }
  }

  // beatJunk: did an expected stable memory rank above an absent junk memory?
  let beatJunk: boolean | null = null;
  if (q.absent && q.absent.length > 0) {
    const firstExpectedRank = contents.findIndex((c) => q.expect.some((e) => c.includes(e)));
    const firstAbsentRank = contents.findIndex((c) => q.absent!.some((a) => c.includes(a)));
    if (firstAbsentRank !== -1) {
      beatJunk = firstExpectedRank !== -1 && firstExpectedRank < firstAbsentRank;
    } else {
      beatJunk = recallAtK > 0; // junk absent — good
    }
  }

  const leaked = q.absent?.some((a) => contents.some((c) => c.includes(a))) ?? false;
  const pass = recallAtK > 0 && !leaked && (beatJunk !== false);

  return { axis: q.axis, id: q.id, query: q.query, recallAtK, precisionAtK, mrr, latencyMs, beatJunk, pass };
}

export function runAxis(ownerId: string, questions: AxisQuestion[], k = 8): { results: AxisResult[]; summary: AxisSummary } {
  const results = questions.map((q) => runAxisQuestion(ownerId, q, k));
  const n = results.length;
  const failures = results.filter((r) => !r.pass).map((r) => ({
    id: r.id,
    query: r.query,
    reason: r.recallAtK === 0 ? "not found in top-K" : "leak: absent memory surfaced",
  }));
  const summary: AxisSummary = {
    axis: questions[0]!.axis,
    meanRecall: results.reduce((s, r) => s + r.recallAtK, 0) / Math.max(1, n),
    meanPrecision: results.reduce((s, r) => s + r.precisionAtK, 0) / Math.max(1, n),
    meanMRR: results.reduce((s, r) => s + r.mrr, 0) / Math.max(1, n),
    meanLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, n),
    passRate: results.filter((r) => r.pass).length / Math.max(1, n),
    total: n,
    failures,
  };
  return { results, summary };
}

export function formatAxisReport(summaries: AxisSummary[]): string {
  const lines: string[] = [];
  lines.push("=".repeat(70));
  lines.push("PAME UNIVERSAL BENCHMARK — 6 axes (the honest report)");
  lines.push("=".repeat(70));
  lines.push("");

  // Legend
  lines.push("Each axis measures a DIFFERENT capability. Failures are the point —");
  lines.push("they show where the system is weak, which is what researchers report.");
  lines.push("");

  for (const s of summaries) {
    const icon = s.passRate === 1 ? "✅" : s.passRate >= 0.7 ? "⚠️ " : "❌";
    lines.push(`${icon} ${s.axis.toUpperCase().padEnd(12)} pass ${Math.round(s.passRate * 100)}% (${s.total - s.failures.length}/${s.total})  recall ${(s.meanRecall * 100).toFixed(0)}%  MRR ${s.meanMRR.toFixed(2)}  ${s.meanLatencyMs.toFixed(1)}ms`);
    for (const f of s.failures) {
      lines.push(`     ❌ ${f.id}: "${f.query}" — ${f.reason}`);
    }
    lines.push("");
  }

  // Overall verdict
  const overall = summaries.reduce((s, x) => s + x.passRate, 0) / summaries.length;
  lines.push("-".repeat(70));
  lines.push(`OVERALL: ${(overall * 100).toFixed(0)}% pass rate across ${summaries.reduce((s, x) => s + x.total, 0)} questions / 6 axes`);
  if (overall >= 0.9) lines.push("Verdict: strong — universal substrate claim is supported.");
  else if (overall >= 0.7) lines.push("Verdict: functional — works in most domains, known gaps below.");
  else lines.push("Verdict: weak — the failures above are real limitations to report honestly.");
  lines.push("");

  // What we are bad at
  const weak = summaries.filter((s) => s.passRate < 1);
  if (weak.length > 0) {
    lines.push("WHERE WE ARE BAD (report this, don't hide it):");
    for (const s of weak) {
      lines.push(`  - ${s.axis}: ${s.failures.length} failures. Worst: "${s.failures[0]?.query ?? ""}"`);
    }
  } else {
    lines.push("WHERE WE ARE BAD: none on this corpus. (Try a larger, blind corpus.)");
  }
  lines.push("");

  return lines.join("\n");
}
