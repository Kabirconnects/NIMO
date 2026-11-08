// Debug: reproduce the agent's recall for "do you know my name?"
import { memoryService } from "../src/service.js";

const r = memoryService.recall({ ownerId: "local", query: "do you know my name", limit: 8, includeEvidence: true });
console.log("Total candidates:", r.totalCandidates);
console.log("Query concepts:", r.queryConcepts);
console.log("\nTop results:");
for (const m of r.memories) {
  console.log(`  [${m.score.toFixed(3)}] ${m.memory.type} matchedBy=${m.matchedBy.join(",")} | ${m.memory.content.slice(0, 90)}`);
}

console.log("\n--- Also test: 'my name' ---");
const r2 = memoryService.recall({ ownerId: "local", query: "my name", limit: 8, includeEvidence: true });
for (const m of r2.memories) {
  console.log(`  [${m.score.toFixed(3)}] ${m.memory.type} | ${m.memory.content.slice(0, 90)}`);
}

console.log("\n--- Active memories (newest 10) ---");
const recent = memoryService.getRecent("local", 10);
for (const m of recent) {
  console.log(`  [${m.type}] ${m.content.slice(0, 90)}`);
}
