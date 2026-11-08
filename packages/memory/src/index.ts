// packages/memory/src/index.ts
// Public surface of Nimo — an associative memory system that learns.
// Agents and the server depend on this entry point, never on internal
// storage modules.

export * from "./domain/index.js";

// Storage boundary (local SQLite)
export { getDb } from "./storage/db.js";

// The engine
export { memoryService } from "./service.js";

// Per-turn prompt context (the agent runtime calls this, never the snapshot)
export { buildMemoryContext, MEMORY_CONTEXT_GUIDANCE } from "./context.js";
export type { PameContext } from "./context.js";

// Agent-facing tools (Stage 6)
export { memoryTools } from "./tools.js";

// Ingestion + retrieval primitives (also reachable via memoryService)
export { capture } from "./ingestion/capture.js";
export { ingest } from "./ingestion/ingest.js";
export { recall } from "./retrieval/search.js";

// Governance
export { DEFAULT_POLICY, evaluateWrite, containsExcludedContent, isRetrievable } from "./governance/policy.js";
export { forgetMemory } from "./governance/forget.js";
