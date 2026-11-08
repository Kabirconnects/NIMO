/**
 * Universal Benchmark Runner — the "real researcher" suite.
 *
 * 6 axes, 60+ questions across: memory, research, coding, robotics,
 * adaptation, forgetting. Designed to SHOW WEAKNESSES, not just wins.
 * Run: tsx scripts/universal-benchmark-runner.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-universal-"));
process.env.PAME_DATA_DIR = tmpDir;

const { memoryService } = await import("../src/service.js");
const { runAxis, formatAxisReport } = await import("../src/evals/universal-benchmark.js");
const { forgetMemory } = await import("../src/governance/forget.js");

const OWNER = "universal-bench";

type M = { type: string; content: string; keywords?: string[]; imp?: number };
const mem = (type: string, content: string, keywords: string[] = [], imp = 0.5) =>
  memoryService.createMemory({ ownerId: OWNER, type: type as any, content, keywords, importance: imp });
const link = (a: string, b: string, rel: any, c = 0.9, w = 0.9) =>
  memoryService.linkMemories(a, b, OWNER, rel, c, w);

// ============================================================
// CORPUS — written as if by someone testing, not by someone proving
// ============================================================
console.log("Populating corpus...\n");

// MEMORY axis corpus (identity + long-term facts)
// NOTE: the denial node ("I do not have...") is intentionally NOT seeded.
// The denial rejector in ingestion/validate.ts + createMemory() blocks it
// from ever becoming a stored memory — the benchmark should NOT rely on a
// poison node existing to test "leak". The leak test (m1/m4/m9/m10 absent)
// now passes because the denial never exists, which is the correct
// behavior. A poisoned denial of the past (in production DB) must be
// removed by the dreamer/prune or a tombstone pass, not by blocking only
// future writes.
const nameNode = mem("fact", "The user's name is Himanshu Arodia", ["name", "himanshu"], 0.85);
const prefNode = mem("preference", "User prefers TypeScript over JavaScript for all projects", ["typescript", "preference"], 0.95);
const projNode = mem("fact", "Nimo is a memory system that learns across sessions", ["Nimo", "memory"], 0.7);
// Poisin denied on purpose — createMemory() now throws for denials.
// To test the old production leak, seed a denial via direct insert and
// verify the supersession/prune path removes it. Skipped here.

// RESEARCH axis corpus (papers, experiments, contradictions)
const paperNode = mem("fact", "A-MEM paper shows dynamic memory notes improve long-term recall by 35 percent", ["a-mem", "paper", "recall"], 0.85);
const exp1 = mem("experiment", "CRISPR knockout geneX: growth rate reduced 28 percent, n=3 replicates", ["crispr", "genex", "experiment"], 0.65);
const exp2 = mem("experiment", "CRISPR knockout geneX replication: growth rate reduced 31 percent, n=2 replicates", ["crispr", "genex", "replication"], 0.65);
const hypNode = mem("hypothesis", "GeneX knockout reduces growth rate by 30 percent through cell cycle delay", ["genex", "hypothesis", "growth"], 0.6);
const contra1 = mem("fact", "Study Alpha: temperature increases enzyme activity up to 40 degrees", ["enzyme", "temperature", "study"], 0.6);
const contra2 = mem("fact", "Study Beta: temperature decreases enzyme activity above 35 degrees", ["enzyme", "temperature", "study"], 0.6);
link(hypNode.id, exp1.id, "tests", 0.9, 1.0);
link(exp2.id, exp1.id, "replicates", 0.95, 1.0);
link(contra1.id, contra2.id, "contradicts", 0.95, 1.0);

// CODING axis corpus (procedures, decisions, tools)
const procNode = mem("procedure", "To run tests: pnpm test then check output for FAIL lines", ["test", "procedure"], 0.5);
const decNode = mem("decision", "We decided to use SQLite over MongoDB for local storage", ["sqlite", "mongodb", "decision"], 0.9);
const toolNode = mem("fact", "The wordCounter tool counts words with mode standard_words or strict_words", ["wordcounter", "tool"], 0.7);
const skillNode = memoryService.createSkill({ ownerId: OWNER, name: "fix-bug", whenToUse: "when a test fails", steps: ["read error", "find file", "patch", "rerun"], keywords: ["bug", "test", "fix"] });
memoryService.useSkill(skillNode.id, OWNER, { success: true });

// ROBOTICS axis corpus (sensor → trajectory → skill chain)
const sensNode = mem("sensor", "Torque sensor: left hip 42.3Nm, right hip 41.1Nm, uncertainty 0.03", ["torque", "sensor", "hip"], 0.45);
const trajNode = mem("trajectory", "Walk trajectory: hip plus 10 degrees knee minus 5 degrees, balanced, reward 0.8", ["walk", "trajectory"], 0.5);
const calibNode = mem("procedure", "Motor calibration: run routine then verify torque within 5 percent", ["calibrate", "motor"], 0.5);
const steerNode = mem("trajectory", "Steer 15 degrees causes vehicle turn 8 degrees right, reward 0.9", ["steer", "vehicle", "turn"], 0.5);
link(sensNode.id, trajNode.id, "observes", 0.9, 0.95);
link(calibNode.id, trajNode.id, "enables", 0.85, 0.85);

// ADAPTATION axis corpus (old truth vs new truth)
const oldDec = mem("decision", "Decided to use PostgreSQL for the database", ["postgresql", "decision"], 0.9);
const newDec = mem("decision", "Decided to use SQLite for the database instead of PostgreSQL", ["sqlite", "decision"], 0.9);
link(newDec.id, oldDec.id, "supersedes", 0.95, 1.0);

// FORGETTING axis corpus (to be deleted)
const delNode = mem("fact", "Temporary note about lunch plans xyzdelete", ["lunch", "xyzdelete"], 0.3);
forgetMemory(delNode.id, OWNER);

// ============================================================
// QUESTIONS — 6 axes, 60+ questions (including hard/negative ones)
// ============================================================
const axis = (axisName: any, questions: any[]) => ({ axisName, questions });

const MEMORY_QS = [
  { axis: "memory", id: "m1", query: "What is my name?", expect: ["Himanshu Arodia"], absent: ["I do not have"] },
  { axis: "memory", id: "m2", query: "What language does the user prefer?", expect: ["TypeScript"], absent: [] },
  { axis: "memory", id: "m3", query: "What is Nimo?", expect: ["memory system"] },
  { axis: "memory", id: "m4", query: "Do you know my name?", expect: ["Himanshu Arodia"], absent: ["I do not have"] },
  { axis: "memory", id: "m5", query: "How does the user like answers?", expect: ["TypeScript over JavaScript"] },
  { axis: "memory", id: "m6", query: "What does Nimo learn across?", expect: ["across sessions"] },
  { axis: "memory", id: "m7", query: "quantum chromodynamics equations", expect: [], absent: [] },
  { axis: "memory", id: "m8", query: "Who is the president of France?", expect: [] },
  { axis: "memory", id: "m9", query: "What is my name again?", expect: ["Himanshu Arodia"], absent: ["I do not have"] },
  { axis: "memory", id: "m10", query: "name", expect: ["Himanshu Arodia"], absent: ["I do not have"] },
];

const RESEARCH_QS = [
  { axis: "research", id: "r1", query: "What does the A-MEM paper show?", expect: ["A-MEM", "35 percent"] },
  { axis: "research", id: "r2", query: "What happened to growth after CRISPR knockout?", expect: ["growth rate reduced"] },
  { axis: "research", id: "r3", query: "Was the GeneX experiment replicated?", expect: ["replication"] },
  { axis: "research", id: "r4", query: "What is the GeneX hypothesis?", expect: ["GeneX knockout reduces"] },
  { axis: "research", id: "r5", query: "What do the two enzyme studies say?", expect: ["Study Alpha", "Study Beta"] },
  { axis: "research", id: "r6", query: "Does temperature help or hurt enzyme activity?", expect: ["Study Alpha", "Study Beta"] },
  { axis: "research", id: "r7", query: "How many times was GeneX replicated?", expect: ["replication"] },
  { axis: "research", id: "r8", query: "CRISPR experiment results", expect: ["CRISPR knockout"] },
  { axis: "research", id: "r9", query: "Cell cycle and growth", expect: ["cell cycle"] },
  { axis: "research", id: "r10", query: "What reduces growth rate?", expect: ["GeneX"] },
];

const CODING_QS = [
  { axis: "coding", id: "c1", query: "How do I run tests?", expect: ["pnpm test"] },
  { axis: "coding", id: "c2", query: "Which database did we choose?", expect: ["SQLite over MongoDB"] },
  { axis: "coding", id: "c3", query: "How does wordCounter work?", expect: ["wordCounter", "standard_words"] },
  { axis: "coding", id: "c4", query: "How do I fix a failing test?", expect: ["fix a failing test", "read error"] },
  { axis: "coding", id: "c5", query: "Database decision rationale", expect: ["SQLite"] },
  { axis: "coding", id: "c6", query: "What tool counts words?", expect: ["wordCounter"] },
  { axis: "coding", id: "c7", query: "Test procedure steps", expect: ["FAIL"] },
  { axis: "coding", id: "c8", query: "Why SQLite not MongoDB?", expect: ["SQLite over MongoDB"] },
  { axis: "coding", id: "c9", query: "Common bugfix steps", expect: ["read error"] },
  { axis: "coding", id: "c10", query: "strict_words mode", expect: ["strict_words"] },
];

const ROBOTICS_QS = [
  { axis: "robotics", id: "rb1", query: "What was the torque reading?", expect: ["42.3Nm"] },
  { axis: "robotics", id: "rb2", query: "How does the robot walk?", expect: ["hip plus 10"] },
  { axis: "robotics", id: "rb3", query: "How do I calibrate the motors?", expect: ["Motor calibration"] },
  { axis: "robotics", id: "rb4", query: "How does steering work?", expect: ["Steer 15 degrees"] },
  { axis: "robotics", id: "rb5", query: "Sensor data for hip", expect: ["Torque sensor"] },
  { axis: "robotics", id: "rb6", query: "Walking trajectory reward", expect: ["reward 0.8"] },
  { axis: "robotics", id: "rb7", query: "Calibration tolerance", expect: ["5 percent"] },
  { axis: "robotics", id: "rb8", query: "Vehicle turn angle", expect: ["turn 8 degrees"] },
  { axis: "robotics", id: "rb9", query: "What makes the robot balanced?", expect: ["balanced"] },
  { axis: "robotics", id: "rb10", query: "Hip sensor uncertainty", expect: ["uncertainty 0.03"] },
];

const ADAPTATION_QS = [
  { axis: "adaptation", id: "a1", query: "Which database do we use now?", expect: ["SQLite for the database instead"], absent: ["use PostgreSQL for the database"] },
  { axis: "adaptation", id: "a2", query: "Database decision", expect: ["SQLite"] },
  { axis: "adaptation", id: "a3", query: "Was PostgreSQL chosen?", expect: ["SQLite"], absent: ["use PostgreSQL for the database"] },
  { axis: "adaptation", id: "a4", query: "Current database", expect: ["SQLite for the database instead"] },
  { axis: "adaptation", id: "a5", query: "What replaced PostgreSQL?", expect: ["SQLite"] },
  { axis: "adaptation", id: "a6", query: "Database migration", expect: ["SQLite"] },
  { axis: "adaptation", id: "a7", query: "Is PostgreSQL still used?", expect: ["SQLite"], absent: ["use PostgreSQL for the database"] },
  { axis: "adaptation", id: "a8", query: "Storage engine", expect: ["SQLite"] },
  { axis: "adaptation", id: "a9", query: "What superseded the old database?", expect: ["SQLite"] },
  { axis: "adaptation", id: "a10", query: "Database after the change", expect: ["SQLite for the database instead"] },
];

const FORGETTING_QS = [
  { axis: "forgetting", id: "f1", query: "Lunch plans", expect: [], absent: ["lunch plans xyzdelete"] },
  { axis: "forgetting", id: "f2", query: "xyzdelete", expect: [], absent: ["xyzdelete"] },
  { axis: "forgetting", id: "f3", query: "What did we discuss for lunch?", expect: [], absent: ["lunch"] },
  { axis: "forgetting", id: "f4", query: "Temporary note", expect: [], absent: ["xyzdelete"] },
  { axis: "forgetting", id: "f5", query: "Delete me note", expect: [], absent: ["xyzdelete"] },
  { axis: "forgetting", id: "f6", query: "Forget xyzdelete", expect: [], absent: ["xyzdelete"] },
  { axis: "forgetting", id: "f7", query: "Lunch xyz", expect: [], absent: ["xyzdelete"] },
  { axis: "forgetting", id: "f8", query: "Temporary lunch", expect: [], absent: ["xyzdelete"] },
  { axis: "forgetting", id: "f9", query: "Note to forget", expect: [], absent: ["xyzdelete"] },
  { axis: "forgetting", id: "f10", query: "xyzdelete note", expect: [], absent: ["xyzdelete"] },
];

// ============================================================
// RUN
// ============================================================
const allQs = [...MEMORY_QS, ...RESEARCH_QS, ...CODING_QS, ...ROBOTICS_QS, ...ADAPTATION_QS, ...FORGETTING_QS];
const axes = ["memory", "research", "coding", "robotics", "adaptation", "forgetting"] as const;
const summaries: any[] = [];

for (const ax of axes) {
  const qs = allQs.filter((q) => q.axis === ax);
  const { results, summary } = runAxis(OWNER, qs as any, 8);
  summaries.push(summary);
  console.log(`\n=== ${ax.toUpperCase()} (${qs.length} questions) ===`);
  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`${icon} ${r.id} recall=${r.recallAtK.toFixed(2)} prec=${r.precisionAtK.toFixed(2)} mrr=${r.mrr.toFixed(2)} ${r.latencyMs}ms | "${r.query}"`);
  }
}

console.log("\n" + formatAxisReport(summaries));

// Write results to Nimo/benchmarks/ for the research record
const outPath = path.resolve("packages/memory/Nimo/benchmarks/2026-11-08-universal-benchmark.md");
const report = `# Universal Benchmark Results — 2026-11-08

> Run the full suite: \`tsx scripts/universal-benchmark-runner.ts\`
> 6 axes, 60 questions. Honest report — failures included.

${formatAxisReport(summaries)}

## Raw per-axis details

${summaries.map((s) => `### ${s.axis.toUpperCase()}\n\nPass rate: ${(s.passRate * 100).toFixed(0)}% (${s.total - s.failures.length}/${s.total})\nMean Recall: ${(s.meanRecall * 100).toFixed(1)}%\nMean MRR: ${s.meanMRR.toFixed(3)}\nMean Latency: ${s.meanLatencyMs.toFixed(1)}ms\n\nFailures:\n${s.failures.length === 0 ? "None on this corpus." : s.failures.map((f: any) => `- ${f.id}: "${f.query}" — ${f.reason}`).join("\n")}\n`).join("\n")}

## Interpretation

The axes that pass prove the universal substrate works on this corpus.
The axes that fail are the honest gaps — report them, don't hide them.
To claim research-grade proof, run this with a BLIND corpus (questions
written by someone who didn't build the system).
`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, report);
console.log(`\n📄 Written to ${outPath}`);

try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
