/**
 * Deep test of the multi-factor memory strength formula.
 * Research basis: A-MEM (2025) dynamic importance + Ebbinghaus ageing.
 * Formula: final = 0.35*relevance + 0.40*normalisedBase + 0.15*effectiveRecency + 0.10*confidence
 * where base = importance * (1 + log(1+degree)/log(1+maxDegree))
 *
 * PageRank was removed from the score: it was never computed in production and
 * its 0.30 weight was permanently zero. Graph centrality still contributes
 * through `base` (degree). Retention contributes exactly once via
 * `effectiveRecency`.
 *
 * Tests: retention class, graph centrality, name vs denial, research hub vs leaf,
 * walking stable vs ephemeral, 5-month-old identity survival.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pame-formula-"));
process.env.PAME_DATA_DIR = tmpDir;

let passed = 0, failed = 0;
const pass = (n: string, d = "") => { passed++; console.log(`PASS ${n}${d ? "  " + d : ""}`); };
const fail = (n: string, d = "") => { failed++; console.log(`FAIL ${n}${d ? "  " + d : ""}`); };
const check = (c: boolean, n: string, d = "") => { c ? pass(n, d) : fail(n, d); };

const { memoryService } = await import("../src/service.js");
const { computeFinalScore, baseStrength, ageingStrength, recencyScore } = await import("../src/retrieval/rank.js");
const { extractCandidates } = await import("../src/ingestion/extract.js");
const { listActiveMemories } = await import("../src/storage/db.js");

const OWNER = "formula-owner";
console.log("\n🧠 PAME Multi-Factor Formula Deep Test\n");

// === 1. Extraction: retention class ===
console.log("--- [EXTRACT] Retention class auto-assignment ---");
const identity = extractCandidates("My name is Asur");
check(identity[0]?.retentionClass === "stable", "[EXTRACT] 'My name is X' -> stable", identity[0]?.retentionClass);
check(identity[0]?.importance === 0.85, "[EXTRACT] identity importance 0.85", String(identity[0]?.importance));
const denial = extractCandidates("I do not have your name stored in my memory");
check(denial[0]?.retentionClass === "ephemeral", "[EXTRACT] denial -> ephemeral", denial[0]?.retentionClass);
check(denial[0]?.type === "observation", "[EXTRACT] denial type observation", denial[0]?.type);
check(denial[0]?.importance === 0.2, "[EXTRACT] denial importance 0.2", String(denial[0]?.importance));
const pref = extractCandidates("I prefer dark mode");
check(pref[0]?.retentionClass === "stable", "[EXTRACT] preference -> stable");
const obs = extractCandidates("API returned an error");
check(obs[0]?.retentionClass === "ephemeral", "[EXTRACT] error observation -> ephemeral");

// === 2. Math: base strength from graph degree (A-MEM) ===
console.log("\n--- [MATH] Dynamic base strength (A-MEM) ---");
const hub: any = { importance: 0.8, graphDegree: 15, retentionClass: "volatile", updatedAt: new Date(), pageRank: 0, lastAccessedAt: new Date() };
const leaf: any = { importance: 0.8, graphDegree: 1, retentionClass: "volatile", updatedAt: new Date(), pageRank: 0, lastAccessedAt: new Date() };
const hubBase = baseStrength(hub, 50);
const leafBase = baseStrength(leaf, 50);
check(hubBase > leafBase, "[MATH] hub base > leaf base", `hub=${hubBase.toFixed(3)} leaf=${leafBase.toFixed(3)}`);
check(hubBase > 1.0, "[MATH] hub base > 1.0", hubBase.toFixed(3));

// === 3. Math: retention class (stable never fades) ===
console.log("\n--- [MATH] Retention class ---");
const oldDate = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000);
const stableOld: any = { ...hub, retentionClass: "stable", lastAccessedAt: oldDate, updatedAt: oldDate, importance: 0.85, graphDegree: 4, pageRank: 0.12 };
const volatileOld: any = { ...hub, retentionClass: "volatile", lastAccessedAt: oldDate, updatedAt: oldDate, importance: 0.85, graphDegree: 4, pageRank: 0.12 };
const ephOld: any = { ...hub, retentionClass: "ephemeral", lastAccessedAt: oldDate, updatedAt: oldDate, importance: 0.85, graphDegree: 4, pageRank: 0.12 };
check(ageingStrength(stableOld, Date.now()) === 1.0, "[MATH] stable never fades (1.0 at 150 days)");
check(ageingStrength(volatileOld, Date.now()) < 0.5, "[MATH] volatile fades", ageingStrength(volatileOld, Date.now()).toFixed(3));
check(ageingStrength(ephOld, Date.now()) < ageingStrength(volatileOld, Date.now()) * 0.4, "[MATH] ephemeral fades fastest");
check(recencyScore({ ...hub, lastAccessedAt: new Date(), updatedAt: new Date() }) > 0.95, "[MATH] fresh recency > 0.95");

// === 4. Formula: name vs denial (the real bug) ===
console.log("\n--- [FORMULA] Name (5mo, degree 4, stable) vs Denial (now, degree 0, ephemeral) ---");
const nameMem: any = { importance: 0.85, graphDegree: 4, retentionClass: "stable", pageRank: 0.12, lastAccessedAt: oldDate, updatedAt: oldDate };
const denialMem: any = { importance: 0.2, graphDegree: 0, retentionClass: "ephemeral", pageRank: 0, lastAccessedAt: new Date(), updatedAt: new Date() };
const nameScore = computeFinalScore(nameMem, 0.8);
const denialScore = computeFinalScore(denialMem, 0.8);
check(nameScore > denialScore, "[FORMULA] 5-month name BEATS fresh denial", `name=${nameScore.toFixed(3)} denial=${denialScore.toFixed(3)}`);
check(nameScore > 0.5, "[FORMULA] name score > 0.5", nameScore.toFixed(3));

// === 5. Formula: research hub vs leaf ===
console.log("\n--- [FORMULA] Research: paper hub (degree 8, stable) vs failed trial (degree 1, ephemeral) ---");
const paper: any = { importance: 0.8, graphDegree: 8, retentionClass: "stable", pageRank: 0.2, lastAccessedAt: oldDate, updatedAt: oldDate };
const failedTrial: any = { importance: 0.3, graphDegree: 1, retentionClass: "ephemeral", pageRank: 0.01, lastAccessedAt: new Date(), updatedAt: new Date() };
check(computeFinalScore(paper, 0.7) > computeFinalScore(failedTrial, 0.7), "[FORMULA] paper hub beats failed trial", `paper=${computeFinalScore(paper,0.7).toFixed(3)} trial=${computeFinalScore(failedTrial,0.7).toFixed(3)}`);

// === 6. Formula: walking safe ===
console.log("\n--- [FORMULA] Walking: proven gait (stable, hub) vs fall (ephemeral, leaf) ---");
const gait: any = { importance: 0.9, graphDegree: 15, retentionClass: "stable", pageRank: 0.25, lastAccessedAt: oldDate, updatedAt: oldDate };
const fell: any = { importance: 0.2, graphDegree: 1, retentionClass: "ephemeral", pageRank: 0, lastAccessedAt: new Date(), updatedAt: new Date() };
check(computeFinalScore(gait, 0.6) > computeFinalScore(fell, 0.6) * 2, "[FORMULA] proven gait >> fall", `gait=${computeFinalScore(gait,0.6).toFixed(3)} fall=${computeFinalScore(fell,0.6).toFixed(3)}`);
check(computeFinalScore(gait, 0) > 0.5, "[FORMULA] gait survives even with zero relevance (offline)", computeFinalScore(gait, 0).toFixed(3));

// === 7. Integration: recall limit raised + degree tracking ===
console.log("\n--- [INTEGRATION] Recall pool + graph degree ---");
// Create 250 memories to exceed the old 200 limit
for (let i = 0; i < 250; i++) {
  memoryService.createMemory({ ownerId: OWNER, type: "observation", content: `Filler observation ${i} about lab ${i}`, keywords: [`lab${i}`] });
}
const oldStable = memoryService.createMemory({ ownerId: OWNER, type: "fact", content: "The user's name is TestAsur", keywords: ["name", "asur"], importance: 0.85 });
memoryService.update(oldStable.id, OWNER, { retentionClass: "stable" } as any);
const actives = listActiveMemories(OWNER, { limit: 5000 });
check(actives.length >= 250, "[INTEGRATION] active pool > 200", `count=${actives.length}`);
const found = actives.some((m) => m.id === oldStable.id);
check(found, "[INTEGRATION] old stable memory in pool (not cut by 200 limit)");
// Graph degree increments on link
const a = memoryService.createMemory({ ownerId: OWNER, type: "fact", content: "Degree test A unique", keywords: ["degreeA"] });
const b = memoryService.createMemory({ ownerId: OWNER, type: "fact", content: "Degree test B unique", keywords: ["degreeB"] });
memoryService.linkMemories(a.id, b.id, OWNER, "related_to", 0.9, 0.9);
const afterLink = listActiveMemories(OWNER, { limit: 5000 }).find((m) => m.id === a.id);
check((afterLink as any)?.graphDegree >= 1, "[INTEGRATION] graphDegree increments on link", String((afterLink as any)?.graphDegree));

// === 8. Integration: recall finds old stable over fresh ephemeral ===
console.log("\n--- [INTEGRATION] End-to-end recall ---");
const r = memoryService.recall({ ownerId: OWNER, query: "user name TestAsur", limit: 8, includeEvidence: true });
check(r.memories.length > 0, "[INTEGRATION] recall returns results", `count=${r.memories.length}`);
const ids = r.memories.map((m) => m.memory.id);
check(ids.includes(oldStable.id), "[INTEGRATION] old stable identity found by recall");
console.log("\nTop 3 recall results:");
for (const m of r.memories.slice(0, 3)) console.log(`  [${m.score.toFixed(3)}] ${m.memory.content.slice(0, 80)}`);

// Summary
console.log("\n============================================================");
console.log(`FORMULA DEEP TEST: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log("============================================================");
try { fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 }); } catch {}
process.exit(failed > 0 ? 1 : 0);
