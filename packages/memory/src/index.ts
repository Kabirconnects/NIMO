// packages/memory/src/index.ts
// Public surface of Nimo — an associative memory system that learns.
// Agents and the server depend on this entry point, never on internal
// storage modules.

export * from "./domain/index.js";

// Storage boundary (local SQLite)
export { getDb, closeDb, withTransaction } from "./storage/db.js";

// The engine
export { memoryService } from "./service.js";
export { MemoryPolicyError } from "./service.js";

// Request-scoped identity / permissions
export {
  runWithMemoryContext,
  requireMemoryContext,
  requirePermission,
  resolveOwnerId,
  isMultiUserDeployment,
  localOwnerId,
  permissionsFor,
  MemoryAccessError,
} from "./runtime/context.js";
export type {
  MemoryRuntimeContext,
  MemoryPermissions,
  AgentMode,
} from "./runtime/context.js";

// Per-turn prompt context (the agent runtime calls this, never the snapshot)
export { buildMemoryContext, MEMORY_CONTEXT_GUIDANCE } from "./context.js";
export type { PameContext } from "./context.js";

// Agent-facing tools. `memoryTools` is the full registry; prefer the split
// sets for mode-aware wiring.
export {
  memoryTools,
  memoryReadTools,
  memoryWriteTools,
  memoryDestructiveTools,
} from "./tools.js";

// Ingestion + retrieval primitives (also reachable via memoryService)
export { capture } from "./ingestion/capture.js";
export { ingest } from "./ingestion/ingest.js";
export { recall } from "./retrieval/search.js";
export { extractCandidates, isQuestion, isInstruction } from "./ingestion/extract.js";

// Governance
export {
  DEFAULT_POLICY,
  evaluateWrite,
  containsExcludedContent,
  detectSecret,
  redactSecrets,
  isRetrievable,
} from "./governance/policy.js";
export { forgetMemory, forgetByQuery } from "./governance/forget.js";

// Conflict / evolution primitives
export {
  assessConflict,
  assessMemoryConflict,
  contradictionScore,
} from "./graph/conflict.js";
export type { ConflictKind, ConflictAssessment } from "./graph/conflict.js";
export { evolve } from "./graph/evolve.js";
