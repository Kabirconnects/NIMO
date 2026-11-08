/**
 * Benchmark Runner — Stage 7
 * Loads a synthetic test corpus, runs three retrieval configs,
 * and reports Recall@K, Precision@K, MRR per category.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-bench-"));
process.env.PAME_DATA_DIR = tmpDir;

const { memoryService } = await import("../src/service.js");
const { runBenchmark, formatBenchmarkReport } = await import("../src/evals/benchmark.js");

const OWNER = "bench-owner";

// Populate corpus with diverse memories across domains
const corpus = [
  { type: "fact", content: "Nimo uses SQLite as local storage engine for memory persistence", keywords: ["sqlite", "storage", "database"] },
  { type: "preference", content: "User prefers concise answers with code examples", keywords: ["concise", "code", "preference"] },
  { type: "decision", content: "We decided to use SQLite over MongoDB for the memory system", keywords: ["sqlite", "mongodb", "decision"] },
  { type: "concept", content: "Spreading activation is how neurons fire through synapses", keywords: ["activation", "neurons", "synapses"] },
  { type: "procedure", content: "How to start the Nimo API server: run pnpm dev in packages/server", keywords: ["api", "server", "start"] },
  { type: "event", content: "Fixed a model registry error on November 5 2026", keywords: ["registry", "error", "fixed"] },
  { type: "fact", content: "PostgreSQL was considered but rejected for complexity", keywords: ["postgresql", "rejected"] },
  { type: "sensor", content: "Torque sensor reading: left_hip 42.3Nm right_hip 41.1Nm", keywords: ["torque", "sensor", "hip"] },
  { type: "trajectory", content: "Walk trajectory: hip+10deg knee-5deg result=balanced reward=0.8", keywords: ["walk", "trajectory", "balanced"] },
  { type: "hypothesis", content: "GeneX knockout reduces growth rate by 30 percent", keywords: ["genex", "growth", "hypothesis"] },
  { type: "experiment", content: "CRISPR knockout geneX observations: growth rate minus 28 percent supported", keywords: ["crispr", "knockout", "experiment"] },
  { type: "fact", content: "Vehicles use steering to turn: steer 15deg causes 8deg turn", keywords: ["steer", "vehicle", "turn"] },
  { type: "goal", content: "Build a complete agent harness with memory system", keywords: ["agent", "harness", "goal"] },
  { type: "observation", content: "API returned undefined model error during testing", keywords: ["api", "error", "undefined"] },
  { type: "procedure", content: "Calibrate motors: run calibration routine then verify torque", keywords: ["calibrate", "motor", "torque"] },
];

const ids: Record<string, string> = {};
for (const item of corpus) {
  const n = memoryService.createMemory({
    ownerId: OWNER,
    type: item.type as any,
    content: item.content,
    keywords: item.keywords,
  });
  ids[item.content] = n.id;
}

// Build edges for graph tests
const walkIds = Object.entries(ids)
  .filter(([content]) => content.includes("Walk") || content.includes("Torque") || content.includes("Calibrate"))
  .map(([, id]) => id);

if (walkIds.length >= 2) {
  memoryService.linkMemories(walkIds[0]!, walkIds[1]!, OWNER, "observes", 0.9, 0.95);
  if (walkIds[2]) memoryService.linkMemories(walkIds[2], walkIds[0]!, OWNER, "enables", 0.85, 0.8);
}

// Build benchmark questions
const questions = [
  { id: "q1", query: "What database does Nimo use?", category: "direct" as const, expectedMemoryIds: [ids["Nimo uses SQLite as local storage engine for memory persistence"]!] },
  { id: "q2", query: "User prefers what style of answers?", category: "direct" as const, expectedMemoryIds: [ids["User prefers concise answers with code examples"]!] },
  { id: "q3", query: "Which database was rejected?", category: "direct" as const, expectedMemoryIds: [ids["PostgreSQL was considered but rejected for complexity"]!] },
  { id: "q4", query: "What error was fixed in November?", category: "cross-session" as const, expectedMemoryIds: [ids["Fixed a model registry error on November 5 2026"]!] },
  { id: "q5", query: "How do neurons fire through connections?", category: "semantic" as const, expectedMemoryIds: [ids["Spreading activation is how neurons fire through synapses"]!] },
  { id: "q6", query: "What was the torque reading?", category: "semantic" as const, expectedMemoryIds: [ids["Torque sensor reading: left_hip 42.3Nm right_hip 41.1Nm"]!] },
  { id: "q7", query: "How does the robot walk?", category: "semantic" as const, expectedMemoryIds: [ids["Walk trajectory: hip+10deg knee-5deg result=balanced reward=0.8"]!] },
  { id: "q8", query: "Steering input and vehicle turn", category: "multi-hop" as const, expectedMemoryIds: [ids["Vehicles use steering to turn: steer 15deg causes 8deg turn"]!] },
  { id: "q9", query: "What happened to growth after knockout?", category: "multi-hop" as const, expectedMemoryIds: [ids["CRISPR knockout geneX observations: growth rate minus 28 percent supported"]!] },
  { id: "q10", query: "Genetic hypothesis about geneX", category: "direct" as const, expectedMemoryIds: [ids["GeneX knockout reduces growth rate by 30 percent"]!] },
  { id: "q11", query: "Motor calibration procedure", category: "direct" as const, expectedMemoryIds: [ids["Calibrate motors: run calibration routine then verify torque"]!] },
  { id: "q12", query: "How to start API", category: "direct" as const, expectedMemoryIds: [ids["How to start the Nimo API server: run pnpm dev in packages/server"]!] },
  { id: "q13", query: "Quantum chromodynamics", category: "negative" as const, expectedMemoryIds: [] },
  { id: "q14", query: "Unicode normalization forms", category: "negative" as const, expectedMemoryIds: [] },
  { id: "q15", query: "Goal of the project", category: "direct" as const, expectedMemoryIds: [ids["Build a complete agent harness with memory system"]!] },
];

console.log("Running benchmark...\n");
const { results, summaries } = runBenchmark(OWNER, questions, 8);
console.log(formatBenchmarkReport(summaries));

// Print per-question breakdown
console.log("\n=== Per-question (hybrid-graph) ===");
for (const r of results.filter((x) => x.config === "hybrid-graph")) {
  const status = r.recallAtK > 0 ? "✅" : "❌";
  console.log(`${status} ${r.questionId} (${r.category}) recall=${r.recallAtK.toFixed(2)} prec=${r.precisionAtK.toFixed(2)} mrr=${r.mrr.toFixed(2)} latency=${r.latencyMs}ms | "${r.query}"`);
}

try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
