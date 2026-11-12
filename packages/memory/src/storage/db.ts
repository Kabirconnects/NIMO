// storage/db.ts
// Local SQLite store (better-sqlite3), a single file beside the agent
// workspace — same storage family as packages/agents session store.
// Owner-scoping is enforced in every query below (owner_id filter).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

import type { MemoryNode } from "../domain/memory.types.js";
import type { MemoryEdge } from "../domain/memory-edge.types.js";
import type { Experience } from "../domain/experience.types.js";
import type { MemoryAuditEntry, MemoryRevision } from "../domain/governance.types.js";

// ---------------------------------------------------------------------------
// Portable paths
// ---------------------------------------------------------------------------
// Never resolve the real user home at module import: importing the package in
// a test (or a read-only environment) must not fail. Resolution is lazy and
// PAME_DB_PATH can point directly at a database file.

let cachedRoot: string | null = null;

export function getRoot(): string {
  if (cachedRoot) return cachedRoot;
  if (process.env.PAME_DB_PATH) {
    cachedRoot = path.dirname(path.resolve(process.env.PAME_DB_PATH));
    return cachedRoot;
  }
  const base =
    process.env.AGENT_WORKSPACE ??
    process.env.PAME_DATA_DIR ??
    path.join(os.homedir(), ".nimo");
  cachedRoot = path.resolve(base);
  return cachedRoot;
}

export function getDbPath(): string {
  if (process.env.PAME_DB_PATH) return path.resolve(process.env.PAME_DB_PATH);
  return path.join(getRoot(), "pame.db");
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS experiences (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      message_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('message','tool_call','tool_result','system_observation','external_document')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_experiences_hash
      ON experiences(owner_id, content_hash);
    CREATE INDEX IF NOT EXISTS idx_experiences_owner
      ON experiences(owner_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('fact','preference','decision','event','concept','procedure','goal','observation','sensor','trajectory','hypothesis','experiment')),
      status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','active','superseded','archived','deleted')),
      visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','workspace','shared')),
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      concepts TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      entities TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      importance REAL NOT NULL DEFAULT 0.5,
      retention_class TEXT NOT NULL DEFAULT 'volatile' CHECK (retention_class IN ('stable','volatile','ephemeral')),
      graph_degree INTEGER NOT NULL DEFAULT 0,
      page_rank REAL NOT NULL DEFAULT 0,
      evidence TEXT NOT NULL DEFAULT '[]',
      valid_from INTEGER,
      valid_until INTEGER,
      supersedes TEXT NOT NULL DEFAULT '[]',
      superseded_by TEXT,
      embedding TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_accessed_at INTEGER
    );
  `);

  // Migration for existing databases: add retention_class, graph_degree, page_rank if missing
  const cols = db.prepare("PRAGMA table_info(memories)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("retention_class")) {
    db.exec("ALTER TABLE memories ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'volatile'");
  }
  if (!colNames.has("graph_degree")) {
    db.exec("ALTER TABLE memories ADD COLUMN graph_degree INTEGER NOT NULL DEFAULT 0");
  }
  if (!colNames.has("page_rank")) {
    db.exec("ALTER TABLE memories ADD COLUMN page_rank REAL NOT NULL DEFAULT 0");
  }
  if (!colNames.has("embedding")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding TEXT");
  }
  // Backfill retention_class by type for existing rows (only if memory_edges exists)
  {
    const hasEdges = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_edges'").get();
    if (hasEdges) {
      db.exec(`UPDATE memories SET retention_class = 'stable' WHERE type IN ('preference','decision') AND retention_class = 'volatile'`);
      db.exec(`UPDATE memories SET retention_class = 'ephemeral' WHERE type IN ('observation') AND retention_class = 'volatile'`);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_owner_status_type
      ON memories(owner_id, status, type);
    CREATE INDEX IF NOT EXISTS idx_memories_owner_updated
      ON memories(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_owner_retention
      ON memories(owner_id, retention_class, updated_at DESC);

    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      from_memory_id TEXT NOT NULL,
      to_memory_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.5,
      evidence_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_unique
      ON memory_edges(owner_id, from_memory_id, to_memory_id, relation);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON memory_edges(owner_id, from_memory_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON memory_edges(owner_id, to_memory_id);

    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      type TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_entities_owner ON memory_entities(owner_id, canonical_name);

    CREATE TABLE IF NOT EXISTS memory_policies (
      owner_id TEXT PRIMARY KEY,
      allow_automatic_capture INTEGER NOT NULL DEFAULT 1,
      allow_inferred_memories INTEGER NOT NULL DEFAULT 1,
      allow_automatic_merge INTEGER NOT NULL DEFAULT 1,
      allow_automatic_evolution INTEGER NOT NULL DEFAULT 1,
      default_visibility TEXT NOT NULL DEFAULT 'private',
      max_evidence_age_days INTEGER,
      max_confidence_auto_activation REAL NOT NULL DEFAULT 0.5,
      excluded_categories TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_revisions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      previous_content TEXT,
      new_content TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('new_evidence','user_correction','consolidation','supersession')),
      evidence_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_revisions ON memory_revisions(owner_id, memory_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS memory_audit (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      actor TEXT NOT NULL CHECK (actor IN ('agent','user','system','worker')),
      action TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit ON memory_audit(owner_id, target_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS memory_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      next_run_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs ON memory_jobs(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_owner ON memory_jobs(owner_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      when_to_use TEXT NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      tools_used TEXT NOT NULL DEFAULT '[]',
      examples TEXT NOT NULL DEFAULT '[]',
      keywords TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      use_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.5,
      importance REAL NOT NULL DEFAULT 0.7,
      status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','active','archived','deleted')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_accessed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_skills_owner_status
      ON skills(owner_id, status, updated_at DESC);
  `);

  // Optional FTS5 index. Builds of SQLite without FTS5 simply fall back to
  // the deterministic in-process keyword scorer.
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        memory_id UNINDEXED,
        owner_id UNINDEXED,
        content,
        summary,
        keywords,
        tags,
        concepts,
        tokenize = 'unicode61'
      );
    `);
    ftsAvailable = true;
  } catch {
    ftsAvailable = false;
  }

  // Repair graph-degree drift once per owner at startup. This is idempotent
  // and cheap for local databases; it fixes historical duplicate-increment
  // bugs without discarding data.
  repairAllGraphDegrees();

  // Backfill the optional FTS index for rows that predate it (or were inserted
  // while FTS5 was unavailable). This is a one-time, idempotent sync.
  syncFts();

  return db;
}

/** Index any non-deleted memory missing from the FTS table. */
function syncFts(): void {
  if (!ftsAvailable) return;
  try {
    getDb().exec(`
      INSERT INTO memory_fts (memory_id, owner_id, content, summary, keywords, tags, concepts)
      SELECT m.id, m.owner_id, m.content, m.summary, m.keywords, m.tags, m.concepts
      FROM memories m
      WHERE m.status != 'deleted'
        AND NOT EXISTS (SELECT 1 FROM memory_fts f WHERE f.memory_id = m.id)
    `);
  } catch {
    /* FTS is an optimisation, never a source of truth */
  }
}

/** Rebuild the FTS index from scratch. Idempotent maintenance operation. */
export function rebuildFtsIndex(): number {
  if (!ftsAvailable) return 0;
  try {
    getDb().exec("DELETE FROM memory_fts");
    syncFts();
    const r = getDb()
      .prepare("SELECT COUNT(*) AS n FROM memory_fts")
      .get() as { n: number };
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

export function closeDb(): void {
  if (db) {
    try { db.close(); } catch { /* best effort */ }
    db = null;
    ftsAvailable = false;
  }
}

/** Run `fn` atomically. Nested calls become savepoints. */
let savepointDepth = 0;
export function withTransaction<T>(fn: () => T): T {
  const database = getDb();
  if (database.inTransaction) {
    // Real savepoint so an inner failure can roll back only its own writes
    // while an outer caller decides whether to continue.
    const name = `pame_sp_${++savepointDepth}`;
    database.exec(`SAVEPOINT ${name}`);
    try {
      const out = fn();
      database.exec(`RELEASE ${name}`);
      return out;
    } catch (err) {
      database.exec(`ROLLBACK TO ${name}`);
      database.exec(`RELEASE ${name}`);
      throw err;
    } finally {
      savepointDepth--;
    }
  }
  savepointDepth = 0;
  return database.transaction(fn)();
}

// ---- helpers ----

export const newId = () => randomUUID();
export const hashContent = (content: string) =>
  createHash("sha256").update(content).digest("hex");
export const now = () => Date.now();
export const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

let ftsAvailable = false;

export function isFtsAvailable(): boolean {
  return ftsAvailable;
}

function ftsDelete(memoryId: string): void {
  if (!ftsAvailable) return;
  try {
    getDb().prepare("DELETE FROM memory_fts WHERE memory_id = ?").run(memoryId);
  } catch { /* best effort */ }
}

function ftsUpsert(node: MemoryNode): void {
  if (!ftsAvailable) return;
  try {
    ftsDelete(node.id);
    getDb()
      .prepare(
        `INSERT INTO memory_fts (memory_id, owner_id, content, summary, keywords, tags, concepts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        node.id,
        node.ownerId,
        node.content,
        node.summary,
        (node.keywords ?? []).join(" "),
        (node.tags ?? []).join(" "),
        (node.concepts ?? []).join(" "),
      );
  } catch { /* FTS is an optimisation, never a source of truth */ }
}

/** Common words that carry no retrieval signal in an FTS OR-query. */
const FTS_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "by", "for",
  "with", "from", "is", "are", "was", "were", "be", "been", "it", "this",
  "that", "these", "those", "i", "we", "you", "he", "she", "they", "my",
  "our", "your", "their", "me", "us", "them", "do", "does", "did", "have",
  "has", "had", "what", "which", "who", "whom", "when", "where", "why",
  "how", "about", "please", "tell", "can", "could", "would", "should",
  "there", "here", "again",
]);

/** Candidate ids from the FTS index, best first. Empty when unavailable. */
export function searchFts(ownerId: string, query: string, limit = 200): string[] {
  if (!ftsAvailable) return [];
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 2 && !FTS_STOPWORDS.has(t))
    .slice(0, 12);
  if (terms.length === 0) return [];
  const match = terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
  try {
    const rows = getDb()
      .prepare(
        `SELECT memory_id FROM memory_fts
         WHERE owner_id = ? AND memory_fts MATCH ?
         ORDER BY bm25(memory_fts) ASC
         LIMIT ?`,
      )
      .all(ownerId, match, limit) as { memory_id: string }[];
    return rows.map((r) => r.memory_id);
  } catch {
    return [];
  }
}

// ---- experiences ----

export function captureExperience(input: {
  ownerId: string;
  content: string;
  type: Experience["type"];
  messageId?: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}): Experience {
  // Content hash includes a random salt so identical content sent in
  // separate turns gets a separate experience row. The UNIQUE constraint
  // on (owner_id, content_hash) was preventing that. We still dedupe at
  // the memory level (consolidate.ts), not the experience level.
  const salt = newId().slice(0, 8);
  const contentHash = hashContent(input.content + "\0" + salt);

  const id = newId();
  const occurredAt = input.occurredAt?.getTime() ?? now();
  const createdAt = now();
  getDb()
    .prepare(
      `INSERT INTO experiences (id, owner_id, message_id, type, content, content_hash, occurred_at, created_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.ownerId,
      input.messageId ?? null,
      input.type,
      input.content,
      contentHash,
      occurredAt,
      createdAt,
      JSON.stringify(input.metadata ?? {}),
    );

  return {
    id,
    ownerId: input.ownerId,
    messageId: input.messageId,
    type: input.type,
    content: input.content,
    contentHash,
    occurredAt: new Date(occurredAt),
    capturedAt: new Date(createdAt),
    metadata: input.metadata ?? {},
  };
}

function rowToExperience(r: Record<string, unknown>): Experience {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    messageId: (r.message_id as string | null) ?? undefined,
    type: r.type as Experience["type"],
    content: String(r.content),
    contentHash: String(r.content_hash),
    occurredAt: new Date(Number(r.occurred_at)),
    capturedAt: new Date(Number(r.created_at)),
    metadata: parseJson(String(r.metadata ?? "{}"), {}),
  };
}

export function findExperience(id: string, ownerId: string): Experience | null {
  const r = getDb()
    .prepare("SELECT * FROM experiences WHERE id = ? AND owner_id = ?")
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return r ? rowToExperience(r) : null;
}

export function listRecentExperiences(ownerId: string, limit = 5): Experience[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM experiences WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
    )
    .all(ownerId, limit) as Record<string, unknown>[];
  return rows.map(rowToExperience);
}

/** Redact one experience's content; the id/provenance row survives. */
export function redactExperience(id: string, ownerId: string): void {
  getDb()
    .prepare(
      `UPDATE experiences
       SET content = '[deleted]', metadata = '{"redacted":true}'
       WHERE id = ? AND owner_id = ?`,
    )
    .run(id, ownerId);
}

/**
 * True when any non-deleted memory (other than `excludeMemoryId`) still cites
 * this experience. Used by deletion so shared provenance is not destroyed.
 */
export function isExperienceReferenced(
  experienceId: string,
  ownerId: string,
  excludeMemoryId: string,
): boolean {
  try {
    const r = getDb()
      .prepare(
        `SELECT COUNT(*) AS n
         FROM memories, json_each(memories.evidence) AS e
         WHERE memories.owner_id = ?
           AND memories.status != 'deleted'
           AND memories.id != ?
           AND json_extract(e.value, '$.experienceId') = ?`,
      )
      .get(ownerId, excludeMemoryId, experienceId) as { n: number } | undefined;
    return Number(r?.n ?? 0) > 0;
  } catch {
    // JSON1 unavailable: fall back to a conservative substring probe.
    const r = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM memories
         WHERE owner_id = ? AND status != 'deleted' AND id != ? AND evidence LIKE ?`,
      )
      .get(ownerId, excludeMemoryId, `%${experienceId}%`) as { n: number } | undefined;
    return Number(r?.n ?? 0) > 0;
  }
}

// ---- memories ----

function rowToMemory(r: Record<string, unknown>): MemoryNode {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    type: r.type as MemoryNode["type"],
    status: r.status as MemoryNode["status"],
    visibility: r.visibility as MemoryNode["visibility"],
    content: String(r.content),
    summary: String(r.summary),
    concepts: parseJson(String(r.concepts), []),
    keywords: parseJson(String(r.keywords), []),
    tags: parseJson(String(r.tags), []),
    entities: parseJson(String(r.entities), []),
    confidence: Number(r.confidence),
    importance: Number(r.importance),
    retentionClass: (r.retention_class as MemoryNode["retentionClass"]) ?? "volatile",
    graphDegree: Number(r.graph_degree ?? 0),
    pageRank: Number(r.page_rank ?? 0),
    evidence: parseJson(String(r.evidence), []),
    validFrom: r.valid_from ? new Date(Number(r.valid_from)) : undefined,
    validUntil: r.valid_until ? new Date(Number(r.valid_until)) : undefined,
    createdAt: new Date(Number(r.created_at)),
    updatedAt: new Date(Number(r.updated_at)),
    lastAccessedAt: r.last_accessed_at ? new Date(Number(r.last_accessed_at)) : undefined,
    supersedes: parseJson(String(r.supersedes), []),
    supersededBy: (r.superseded_by as string | null) ?? undefined,
    embedding: r.embedding ? parseJson<number[] | undefined>(String(r.embedding), undefined) : undefined,
  };
}

export function insertMemory(
  node: Omit<MemoryNode, "id" | "createdAt" | "updatedAt" | "graphDegree" | "pageRank">,
): MemoryNode {
  const id = newId();
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO memories (id, owner_id, type, status, visibility, content, summary, concepts, keywords, tags, entities, confidence, importance, retention_class, evidence, valid_from, valid_until, supersedes, superseded_by, embedding, created_at, updated_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      node.ownerId,
      node.type,
      node.status,
      node.visibility,
      node.content,
      node.summary,
      JSON.stringify(node.concepts),
      JSON.stringify(node.keywords),
      JSON.stringify(node.tags),
      JSON.stringify(node.entities),
      node.confidence,
      node.importance,
      node.retentionClass ?? "volatile",
      JSON.stringify(node.evidence),
      node.validFrom?.getTime() ?? null,
      node.validUntil?.getTime() ?? null,
      JSON.stringify(node.supersedes ?? []),
      node.supersededBy ?? null,
      node.embedding ? JSON.stringify(node.embedding) : null,
      t,
      t,
      node.lastAccessedAt?.getTime() ?? null,
    );
  const created = findMemory(id, node.ownerId)!;
  ftsUpsert(created);
  return created;
}

export function findMemory(id: string, ownerId: string): MemoryNode | null {
  const r = getDb()
    .prepare("SELECT * FROM memories WHERE id = ? AND owner_id = ?")
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return r ? rowToMemory(r) : null;
}

export function countActiveMemories(ownerId: string): number {
  const r = getDb()
    .prepare("SELECT COUNT(*) AS n FROM memories WHERE owner_id = ? AND status = 'active'")
    .get(ownerId) as { n: number };
  return Number(r?.n ?? 0);
}

export function listActiveMemories(
  ownerId: string,
  opts: { type?: MemoryNode["type"]; limit?: number } = {},
): MemoryNode[] {
  const sql = opts.type
    ? "SELECT * FROM memories WHERE owner_id = ? AND status = 'active' AND type = ? ORDER BY updated_at DESC, id ASC LIMIT ?"
    : "SELECT * FROM memories WHERE owner_id = ? AND status = 'active' ORDER BY updated_at DESC, id ASC LIMIT ?";
  const rows = (
    opts.type
      ? getDb().prepare(sql).all(ownerId, opts.type, opts.limit ?? 50)
      : getDb().prepare(sql).all(ownerId, opts.limit ?? 50)
  ) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

/** Active memories, highest importance first — used to cap candidate scans. */
export function listActiveMemoriesByImportance(ownerId: string, limit: number): MemoryNode[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM memories WHERE owner_id = ? AND status = 'active' ORDER BY importance DESC, updated_at DESC, id ASC LIMIT ?",
    )
    .all(ownerId, limit) as Record<string, unknown>[];
  return rows.map(rowToMemory);
}

export function updateMemory(id: string, ownerId: string, changes: Partial<MemoryNode>): MemoryNode | null {
  const setClauses: string[] = [];
  const vals: unknown[] = [];

  const push = (col: string, v: unknown) => {
    setClauses.push(`${col} = ?`);
    vals.push(v ?? null);
  };

  if (changes.content !== undefined) push("content", changes.content);
  if (changes.summary !== undefined) push("summary", changes.summary);
  if (changes.status !== undefined) push("status", changes.status);
  if (changes.confidence !== undefined) push("confidence", changes.confidence);
  if (changes.importance !== undefined) push("importance", changes.importance);
  if (changes.retentionClass !== undefined) push("retention_class", changes.retentionClass);
  if (changes.graphDegree !== undefined) push("graph_degree", changes.graphDegree);
  if (changes.pageRank !== undefined) push("page_rank", changes.pageRank);
  if (changes.concepts !== undefined) push("concepts", JSON.stringify(changes.concepts));
  if (changes.keywords !== undefined) push("keywords", JSON.stringify(changes.keywords));
  if (changes.tags !== undefined) push("tags", JSON.stringify(changes.tags));
  if (changes.entities !== undefined) push("entities", JSON.stringify(changes.entities));
  if (changes.evidence !== undefined) push("evidence", JSON.stringify(changes.evidence));
  if (changes.supersededBy !== undefined) push("superseded_by", changes.supersededBy);
  if (changes.lastAccessedAt !== undefined) push("last_accessed_at", changes.lastAccessedAt?.getTime());
  if (changes.validUntil !== undefined) push("valid_until", changes.validUntil?.getTime());
  if (changes.embedding !== undefined) push("embedding", changes.embedding ? JSON.stringify(changes.embedding) : null);

  push("updated_at", now());

  getDb()
    .prepare(`UPDATE memories SET ${setClauses.join(", ")} WHERE id = ? AND owner_id = ?`)
    .run(...vals, id, ownerId);
  const after = findMemory(id, ownerId);
  if (after) ftsUpsert(after);
  return after;
}

/** Low-level redaction used by the deletion lifecycle. Never leaves content. */
export function redactMemoryRow(id: string, ownerId: string): void {
  getDb()
    .prepare(
      `UPDATE memories
       SET content = '[deleted]',
           summary = '[deleted]',
           concepts = '[]',
           keywords = '[]',
           tags = '[]',
           entities = '[]',
           evidence = '[]',
           embedding = NULL,
           supersedes = '[]',
           superseded_by = NULL,
           graph_degree = 0,
           page_rank = 0,
           status = 'deleted',
           valid_until = ?,
           updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    )
    .run(now(), now(), id, ownerId);
  ftsDelete(id);
}

// ---- edges ----

function rowToEdge(r: Record<string, unknown>): MemoryEdge {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    fromMemoryId: String(r.from_memory_id),
    toMemoryId: String(r.to_memory_id),
    relation: r.relation as MemoryEdge["relation"],
    weight: Number(r.weight),
    confidence: Number(r.confidence),
    evidenceIds: parseJson(String(r.evidence_ids), []),
    createdAt: new Date(Number(r.created_at)),
    updatedAt: new Date(Number(r.updated_at)),
  };
}

export function insertEdge(edge: Omit<MemoryEdge, "id" | "createdAt" | "updatedAt">): MemoryEdge {
  return withTransaction(() => {
    const id = newId();
    const t = now();
    const result = getDb()
      .prepare(
        `INSERT OR IGNORE INTO memory_edges (id, owner_id, from_memory_id, to_memory_id, relation, weight, confidence, evidence_ids, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, edge.ownerId, edge.fromMemoryId, edge.toMemoryId, edge.relation, edge.weight, edge.confidence, JSON.stringify(edge.evidenceIds), t, t);
    const r = getDb()
      .prepare("SELECT * FROM memory_edges WHERE owner_id = ? AND from_memory_id = ? AND to_memory_id = ? AND relation = ?")
      .get(edge.ownerId, edge.fromMemoryId, edge.toMemoryId, edge.relation) as Record<string, unknown>;
    // Only a genuinely new row changes degree. INSERT OR IGNORE makes
    // duplicate links idempotent instead of inflating graph_degree.
    if (result.changes > 0) {
      getDb().prepare("UPDATE memories SET graph_degree = graph_degree + 1 WHERE id = ? AND owner_id = ?").run(edge.fromMemoryId, edge.ownerId);
      getDb().prepare("UPDATE memories SET graph_degree = graph_degree + 1 WHERE id = ? AND owner_id = ?").run(edge.toMemoryId, edge.ownerId);
    }
    return rowToEdge(r);
  });
}

/** Explicit learning op — never called during recall. */
export function reinforceEdge(ownerId: string, fromMemoryId: string, toMemoryId: string, relation: string, deltaWeight = 0.05): void {
  getDb().prepare(`
    UPDATE memory_edges
    SET weight = MIN(1.0, weight + ?), confidence = MIN(1.0, confidence + ?), updated_at = ?
    WHERE owner_id = ? AND from_memory_id = ? AND to_memory_id = ? AND relation = ?
  `).run(deltaWeight, deltaWeight / 2, now(), ownerId, fromMemoryId, toMemoryId, relation);
}

export function edgesFrom(fromMemoryId: string, ownerId: string): MemoryEdge[] {
  const rows = getDb()
    .prepare("SELECT * FROM memory_edges WHERE from_memory_id = ? AND owner_id = ? ORDER BY id ASC")
    .all(fromMemoryId, ownerId) as Record<string, unknown>[];
  return rows.map(rowToEdge);
}

export function edgesTo(toMemoryId: string, ownerId: string): MemoryEdge[] {
  const rows = getDb()
    .prepare("SELECT * FROM memory_edges WHERE to_memory_id = ? AND owner_id = ? ORDER BY id ASC")
    .all(toMemoryId, ownerId) as Record<string, unknown>[];
  return rows.map(rowToEdge);
}

export function edgesFor(memoryId: string, ownerId: string): MemoryEdge[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM memory_edges WHERE owner_id = ? AND (from_memory_id = ? OR to_memory_id = ?) ORDER BY id ASC",
    )
    .all(ownerId, memoryId, memoryId) as Record<string, unknown>[];
  return rows.map(rowToEdge);
}

/** Delete one edge and keep both endpoints' degree accurate. */
export function deleteEdge(edgeId: string, ownerId: string): boolean {
  return withTransaction(() => {
    const r = getDb()
      .prepare("SELECT * FROM memory_edges WHERE id = ? AND owner_id = ?")
      .get(edgeId, ownerId) as Record<string, unknown> | undefined;
    if (!r) return false;
    const from = String(r.from_memory_id);
    const to = String(r.to_memory_id);
    getDb().prepare("DELETE FROM memory_edges WHERE id = ? AND owner_id = ?").run(edgeId, ownerId);
    decrementDegree(from, ownerId, 1);
    decrementDegree(to, ownerId, 1);
    return true;
  });
}

function decrementDegree(memoryId: string, ownerId: string, by: number): void {
  getDb()
    .prepare("UPDATE memories SET graph_degree = MAX(0, graph_degree - ?) WHERE id = ? AND owner_id = ?")
    .run(by, memoryId, ownerId);
}

export function deleteEdgesForMemory(memoryId: string, ownerId: string): number {
  return withTransaction(() => {
    const rows = getDb()
      .prepare("SELECT * FROM memory_edges WHERE owner_id = ? AND (from_memory_id = ? OR to_memory_id = ?)")
      .all(ownerId, memoryId, memoryId) as Record<string, unknown>[];
    if (rows.length === 0) return 0;

    const decrements = new Map<string, number>();
    for (const r of rows) {
      const from = String(r.from_memory_id);
      const to = String(r.to_memory_id);
      decrements.set(from, (decrements.get(from) ?? 0) + 1);
      decrements.set(to, (decrements.get(to) ?? 0) + 1);
    }
    for (const [id, count] of decrements) {
      if (id === memoryId) continue; // deleted memory is reset to 0 below
      decrementDegree(id, ownerId, count);
    }
    getDb().prepare("UPDATE memories SET graph_degree = 0 WHERE id = ? AND owner_id = ?").run(memoryId, ownerId);
    getDb()
      .prepare("DELETE FROM memory_edges WHERE owner_id = ? AND (from_memory_id = ? OR to_memory_id = ?)")
      .run(ownerId, memoryId, memoryId);
    return rows.length;
  });
}

/** Recompute graph_degree from the edge table. Idempotent repair operation. */
export function repairGraphDegrees(ownerId: string): number {
  return withTransaction(() => {
    // Drop edges whose endpoints no longer exist (or are soft-deleted) before
    // recomputing, so repair also heals orphaned relationships.
    getDb()
      .prepare(
        `DELETE FROM memory_edges
         WHERE owner_id = ?
           AND (
             from_memory_id NOT IN (SELECT id FROM memories WHERE owner_id = ? AND status != 'deleted')
             OR to_memory_id NOT IN (SELECT id FROM memories WHERE owner_id = ? AND status != 'deleted')
           )`,
      )
      .run(ownerId, ownerId, ownerId);
    const r = getDb()
      .prepare(
        `UPDATE memories SET graph_degree = (
           SELECT COUNT(*) FROM memory_edges
           WHERE memory_edges.owner_id = memories.owner_id
             AND (memory_edges.from_memory_id = memories.id OR memory_edges.to_memory_id = memories.id)
         )
         WHERE owner_id = ?`,
      )
      .run(ownerId);
    return r.changes;
  });
}

export function repairAllGraphDegrees(): void {
  try {
    getDb().exec(`
      DELETE FROM memory_edges
      WHERE from_memory_id NOT IN (SELECT id FROM memories WHERE status != 'deleted')
         OR to_memory_id NOT IN (SELECT id FROM memories WHERE status != 'deleted')
    `);
    getDb().exec(`
      UPDATE memories SET graph_degree = (
        SELECT COUNT(*) FROM memory_edges
        WHERE memory_edges.owner_id = memories.owner_id
          AND (memory_edges.from_memory_id = memories.id OR memory_edges.to_memory_id = memories.id)
      )
    `);
  } catch { /* table may not exist yet */ }
}

// ---- revisions & audit ----

export function insertRevision(r: Omit<MemoryRevision, "id" | "createdAt">): void {
  getDb()
    .prepare(
      `INSERT INTO memory_revisions (id, memory_id, owner_id, previous_content, new_content, reason, evidence_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), r.memoryId, r.ownerId, r.previousContent ?? null, r.newContent, r.reason, JSON.stringify(r.evidenceIds), now());
}

export function revisionsFor(memoryId: string, ownerId: string): MemoryRevision[] {
  const rows = getDb()
    .prepare("SELECT * FROM memory_revisions WHERE memory_id = ? AND owner_id = ? ORDER BY created_at ASC, id ASC")
    .all(memoryId, ownerId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    memoryId: String(r.memory_id),
    ownerId: String(r.owner_id),
    previousContent: (r.previous_content as string | null) ?? undefined,
    newContent: String(r.new_content),
    reason: r.reason as MemoryRevision["reason"],
    evidenceIds: parseJson(String(r.evidence_ids), []),
    createdAt: new Date(Number(r.created_at)),
  }));
}

/** Redact revision bodies while retaining the non-sensitive audit history. */
export function redactRevisionsForMemory(memoryId: string, ownerId: string): number {
  const r = getDb()
    .prepare(
      `UPDATE memory_revisions
       SET previous_content = NULL, new_content = '[deleted]'
       WHERE memory_id = ? AND owner_id = ?`,
    )
    .run(memoryId, ownerId);
  return r.changes;
}

/** Delete old revision bodies (retention). Keeps the most recent revision. */
export function pruneRevisions(ownerId: string, olderThanMs: number, keepLatest = 1): number {
  const rows = getDb()
    .prepare(
      `SELECT id, memory_id FROM memory_revisions
       WHERE owner_id = ? AND created_at < ?
       ORDER BY memory_id ASC, created_at DESC`,
    )
    .all(ownerId, now() - olderThanMs) as { id: string; memory_id: string }[];
  const keep = new Map<string, number>();
  let deleted = 0;
  const del = getDb().prepare("DELETE FROM memory_revisions WHERE id = ? AND owner_id = ?");
  for (const row of rows) {
    const seen = keep.get(row.memory_id) ?? 0;
    if (seen < keepLatest) {
      keep.set(row.memory_id, seen + 1);
      continue;
    }
    deleted += del.run(row.id, ownerId).changes;
  }
  return deleted;
}

export function recordAudit(entry: Omit<MemoryAuditEntry, "id" | "createdAt">): void {
  getDb()
    .prepare(
      `INSERT INTO memory_audit (id, owner_id, actor, action, target_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), entry.ownerId, entry.actor, entry.action, entry.targetId, entry.reason ?? null, now());
}

export function auditFor(targetId: string, ownerId: string): MemoryAuditEntry[] {
  const rows = getDb()
    .prepare("SELECT * FROM memory_audit WHERE target_id = ? AND owner_id = ? ORDER BY created_at ASC, id ASC")
    .all(targetId, ownerId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    ownerId: String(r.owner_id),
    actor: r.actor as MemoryAuditEntry["actor"],
    action: r.action as MemoryAuditEntry["action"],
    targetId: String(r.target_id),
    reason: (r.reason as string | null) ?? undefined,
    createdAt: new Date(Number(r.created_at)),
  }));
}

// ---- jobs ----

export interface JobRow {
  id: string;
  ownerId: string;
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
}

export function enqueueJob(
  ownerId: string,
  kind: string,
  payload: Record<string, unknown> = {},
  opts: { maxAttempts?: number; nextRunAt?: number } = {},
): string {
  const id = newId();
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO memory_jobs (id, owner_id, kind, payload, status, attempts, max_attempts, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    )
    .run(id, ownerId, kind, JSON.stringify(payload), opts.maxAttempts ?? 5, opts.nextRunAt ?? t, t, t);
  return id;
}

export function claimJob(kind: string, ownerId?: string): JobRow | null {
  return withTransaction(() => {
    const t = now();
    const r = (
      ownerId
        ? getDb()
            .prepare(
              `SELECT * FROM memory_jobs
               WHERE kind = ? AND owner_id = ? AND status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?)
               ORDER BY created_at ASC, id ASC LIMIT 1`,
            )
            .get(kind, ownerId, t)
        : getDb()
            .prepare(
              `SELECT * FROM memory_jobs
               WHERE kind = ? AND status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?)
               ORDER BY created_at ASC, id ASC LIMIT 1`,
            )
            .get(kind, t)
    ) as Record<string, unknown> | undefined;
    if (!r) return null;
    getDb()
      .prepare("UPDATE memory_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?")
      .run(t, String(r.id));
    return {
      id: String(r.id),
      ownerId: String(r.owner_id),
      kind: String(r.kind),
      status: "running",
      attempts: Number(r.attempts) + 1,
      maxAttempts: Number(r.max_attempts),
      payload: parseJson(String(r.payload), {}),
    };
  });
}

/**
 * Finish a job. Failures are retried with exponential backoff until
 * max_attempts, then marked "dead" so they are visible instead of silently
 * looping. An empty worker can no longer mark a job as a success.
 */
export function finishJob(id: string, ok: boolean, error?: string): void {
  const r = getDb()
    .prepare("SELECT attempts, max_attempts FROM memory_jobs WHERE id = ?")
    .get(id) as { attempts: number; max_attempts: number } | undefined;
  if (!r) return;
  if (ok) {
    getDb()
      .prepare("UPDATE memory_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?")
      .run(now(), id);
    return;
  }
  const attempts = Number(r.attempts);
  const maxAttempts = Number(r.max_attempts);
  if (attempts >= maxAttempts) {
    getDb()
      .prepare("UPDATE memory_jobs SET status = 'dead', last_error = ?, updated_at = ? WHERE id = ?")
      .run(error ?? "unknown error", now(), id);
    return;
  }
  const backoff = Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
  getDb()
    .prepare("UPDATE memory_jobs SET status = 'pending', last_error = ?, next_run_at = ?, updated_at = ? WHERE id = ?")
    .run(error ?? "unknown error", now() + backoff, now(), id);
}

/** Put stale "running" jobs back in the queue after a crash. */
export function recoverStaleJobs(olderThanMs = 5 * 60_000): number {
  const r = getDb()
    .prepare(
      `UPDATE memory_jobs SET status = 'pending', next_run_at = ?, updated_at = ?
       WHERE status = 'running' AND updated_at < ?`,
    )
    .run(now(), now(), now() - olderThanMs);
  return r.changes;
}

export function jobStats(ownerId: string): Record<string, number> {
  const rows = getDb()
    .prepare("SELECT status, COUNT(*) AS n FROM memory_jobs WHERE owner_id = ? GROUP BY status")
    .all(ownerId) as { status: string; n: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

// ---- skills ----

function rowToSkill(r: Record<string, unknown>): import("../domain/skill.types.js").Skill {
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    name: String(r.name),
    whenToUse: String(r.when_to_use),
    steps: parseJson(String(r.steps), []),
    toolsUsed: parseJson(String(r.tools_used), []),
    examples: parseJson(String(r.examples), []),
    keywords: parseJson(String(r.keywords), []),
    tags: parseJson(String(r.tags), []),
    useCount: Number(r.use_count),
    successCount: Number(r.success_count),
    failureCount: Number(r.failure_count),
    confidence: Number(r.confidence),
    importance: Number(r.importance),
    status: r.status as import("../domain/skill.types.js").SkillStatus,
    createdAt: new Date(Number(r.created_at)),
    updatedAt: new Date(Number(r.updated_at)),
    lastAccessedAt: r.last_accessed_at ? new Date(Number(r.last_accessed_at)) : undefined,
  };
}

export function insertSkill(input: import("../domain/skill.types.js").CreateSkillInput): import("../domain/skill.types.js").Skill {
  const id = newId();
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO skills (id, owner_id, name, when_to_use, steps, tools_used, examples, keywords, tags, use_count, success_count, failure_count, confidence, importance, status, created_at, updated_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, 'candidate', ?, ?, ?)`,
    )
    .run(
      id,
      input.ownerId,
      input.name,
      input.whenToUse,
      JSON.stringify(input.steps),
      JSON.stringify(input.toolsUsed ?? []),
      JSON.stringify(input.examples ?? []),
      JSON.stringify(input.keywords ?? []),
      JSON.stringify(input.tags ?? []),
      input.confidence ?? 0.5,
      input.importance ?? 0.7,
      t,
      t,
      null,
    );
  return findSkill(id, input.ownerId)!;
}

export function findSkill(id: string, ownerId: string): import("../domain/skill.types.js").Skill | null {
  const r = getDb()
    .prepare("SELECT * FROM skills WHERE id = ? AND owner_id = ?")
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return r ? rowToSkill(r) : null;
}

export function listActiveSkills(ownerId: string, limit = 100): import("../domain/skill.types.js").Skill[] {
  const rows = getDb()
    .prepare("SELECT * FROM skills WHERE owner_id = ? AND status = 'active' ORDER BY updated_at DESC, id ASC LIMIT ?")
    .all(ownerId, limit) as Record<string, unknown>[];
  return rows.map(rowToSkill);
}

export function updateSkill(
  id: string,
  ownerId: string,
  changes: Partial<import("../domain/skill.types.js").Skill>,
): import("../domain/skill.types.js").Skill | null {
  const setClauses: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    setClauses.push(`${col} = ?`);
    vals.push(v ?? null);
  };
  if (changes.status !== undefined) push("status", changes.status);
  if (changes.useCount !== undefined) push("use_count", changes.useCount);
  if (changes.successCount !== undefined) push("success_count", changes.successCount);
  if (changes.failureCount !== undefined) push("failure_count", changes.failureCount);
  if (changes.confidence !== undefined) push("confidence", changes.confidence);
  if (changes.importance !== undefined) push("importance", changes.importance);
  if (changes.lastAccessedAt !== undefined) push("last_accessed_at", changes.lastAccessedAt?.getTime());
  push("updated_at", now());
  if (setClauses.length === 1) return findSkill(id, ownerId);
  getDb()
    .prepare(`UPDATE skills SET ${setClauses.join(", ")} WHERE id = ? AND owner_id = ?`)
    .run(...vals, id, ownerId);
  return findSkill(id, ownerId);
}

// ---- retention / maintenance ----

export interface RetentionResult {
  archivedMemories: number;
  redactedExperiences: number;
  prunedRevisions: number;
  redactedMemories: number;
}

/**
 * Apply documented retention rules. Only ephemeral memories expire
 * automatically; stable/volatile memories are never deleted by a timer.
 */
export function applyRetention(
  ownerId: string,
  opts: { ephemeralTtlDays?: number; experienceTtlDays?: number; revisionTtlDays?: number } = {},
): RetentionResult {
  return withTransaction(() => {
    const ephemeralTtl = (opts.ephemeralTtlDays ?? 30) * 86_400_000;
    const experienceTtl = (opts.experienceTtlDays ?? 365) * 86_400_000;
    const revisionTtl = (opts.revisionTtlDays ?? 365) * 86_400_000;

    const archived = getDb()
      .prepare(
        `UPDATE memories SET status = 'archived', updated_at = ?
         WHERE owner_id = ? AND status = 'active' AND retention_class = 'ephemeral'
           AND updated_at < ? AND (valid_until IS NULL OR valid_until < ?)`,
      )
      .run(now(), ownerId, now() - ephemeralTtl, now()).changes;

    const redactedExperiences = getDb()
      .prepare(
        `UPDATE experiences SET content = '[expired]', metadata = '{"expired":true}'
         WHERE owner_id = ? AND created_at < ? AND content != '[expired]'`,
      )
      .run(ownerId, now() - experienceTtl).changes;

    const pruned = pruneRevisions(ownerId, revisionTtl, 1);

    // Deleted rows keep only redacted shells; hard-delete ancient shells.
    const redactedMemories = getDb()
      .prepare(
        `DELETE FROM memories WHERE owner_id = ? AND status = 'deleted' AND updated_at < ?`,
      )
      .run(ownerId, now() - experienceTtl).changes;

    return {
      archivedMemories: archived,
      redactedExperiences,
      prunedRevisions: pruned,
      redactedMemories,
    };
  });
}
