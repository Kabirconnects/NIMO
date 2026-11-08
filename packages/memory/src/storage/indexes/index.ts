// storage/indexes/index.ts
// Stage 3: local search indexes live here. With SQLite + better-sqlite3 the
// plan is an FTS5 virtual table (keyword/BM25) over content/summary/keywords/
// tags, plus a vector table for embeddings — owner-scoped like everything else.
// No external search service is introduced. Stub until Stage 3.

export const MEMORY_INDEXES = {
  vector: {
    table: "memories",
    field: "embedding",
    filters: ["owner_id", "status", "visibility"],
  },
  text: {
    table: "memories",
    fields: ["content", "summary", "keywords", "tags"],
    filters: ["owner_id", "status"],
  },
  entity: {
    table: "memories",
    field: "entities",
  },
  time: {
    table: "memories",
    field: "updated_at",
  },
} as const;
