// storage/db.ts
// Local SQLite store (better-sqlite3), a single file beside the agent
// workspace — same storage family as packages/agents session store.
// Owner-scoping is enforced in every query below (owner_id filter).

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";

import type { MemoryNode } from "../domain/memory.types.js";
import type { MemoryEdge } from "../domain/memory-edge.types.js";
import type { Experience } from "../domain/experience.types.js";
import type { MemoryAuditEntry, MemoryRevision } from "../domain/governance.types.js";

const DEFAULT_ROOT = String.raw`C:\Users\Himanshu Arodia\.nimo`;

export const ROOT = fs.realpathSync(
  path.resolve(
    process.env.AGENT_WORKSPACE ??
    process.env.PAME_DATA_DIR ??
    DEFAULT_ROOT,
  ),
);

const DB_PATH = path.join(ROOT, "pame.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(ROOT, { recursive: true });
  db = new Database(DB_PATH);
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
  // Backfill retention_class by type for existing rows (only if memory_edges exists)
  {
    const hasEdges = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_edges'").get();
    if (hasEdges) {
      db.exec(`UPDATE memories SET retention_class = 'stable' WHERE type IN ('preference','decision') AND retention_class = 'volatile'`);
      db.exec(`UPDATE memories SET retention_class = 'ephemeral' WHERE type IN ('observation') AND retention_class = 'volatile'`);
      db.exec(`
        UPDATE memories SET graph_degree = (
          SELECT COUNT(*) FROM memory_edges
          WHERE (memory_edges.from_memory_id = memories.id OR memory_edges.to_memory_id = memories.id)
          AND memory_edges.owner_id = memories.owner_id
        )
      `);
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_owner_status_type
      ON memories(owner_id, status, type);
    CREATE INDEX IF NOT EXISTS idx_memories_owner_updated
      ON memories(owner_id, updated_at DESC);

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

  return db;
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
  };
}

export function insertMemory(node: Omit<MemoryNode, "id" | "createdAt" | "updatedAt" | "graphDegree" | "pageRank">): MemoryNode {
  const id = newId();
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO memories (id, owner_id, type, status, visibility, content, summary, concepts, keywords, tags, entities, confidence, importance, retention_class, evidence, valid_from, valid_until, supersedes, superseded_by, created_at, updated_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      t,
      t,
      node.lastAccessedAt?.getTime() ?? null,
    );
  return findMemory(id, node.ownerId)!;
}

export function findMemory(id: string, ownerId: string): MemoryNode | null {
  const r = getDb()
    .prepare("SELECT * FROM memories WHERE id = ? AND owner_id = ?")
    .get(id, ownerId) as Record<string, unknown> | undefined;
  return r ? rowToMemory(r) : null;
}

export function listActiveMemories(
  ownerId: string,
  opts: { type?: MemoryNode["type"]; limit?: number } = {},
): MemoryNode[] {
  const sql = opts.type
    ? "SELECT * FROM memories WHERE owner_id = ? AND status = 'active' AND type = ? ORDER BY updated_at DESC LIMIT ?"
    : "SELECT * FROM memories WHERE owner_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT ?";
  const rows = (
    opts.type
      ? getDb().prepare(sql).all(ownerId, opts.type, opts.limit ?? 50)
      : getDb().prepare(sql).all(ownerId, opts.limit ?? 50)
  ) as Record<string, unknown>[];
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

  push("updated_at", now());

  getDb()
    .prepare(`UPDATE memories SET ${setClauses.join(", ")} WHERE id = ? AND owner_id = ?`)
    .run(...vals, id, ownerId);
  return findMemory(id, ownerId);
}

/** Soft-delete: status flips immediately so retrieval excludes it. */
export function tombstoneMemory(id: string, ownerId: string): void {
  getDb()
    .prepare("UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ? AND owner_id = ?")
    .run(now(), id, ownerId);
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
  const id = newId();
  const t = now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO memory_edges (id, owner_id, from_memory_id, to_memory_id, relation, weight, confidence, evidence_ids, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, edge.ownerId, edge.fromMemoryId, edge.toMemoryId, edge.relation, edge.weight, edge.confidence, JSON.stringify(edge.evidenceIds), t, t);
  const r = getDb()
    .prepare("SELECT * FROM memory_edges WHERE owner_id = ? AND from_memory_id = ? AND to_memory_id = ? AND relation = ?")
    .get(edge.ownerId, edge.fromMemoryId, edge.toMemoryId, edge.relation) as Record<string, unknown>;
  // Bump graph degree for both endpoints (A-MEM dynamic importance)
  getDb().prepare("UPDATE memories SET graph_degree = graph_degree + 1 WHERE id = ? AND owner_id = ?").run(edge.fromMemoryId, edge.ownerId);
  getDb().prepare("UPDATE memories SET graph_degree = graph_degree + 1 WHERE id = ? AND owner_id = ?").run(edge.toMemoryId, edge.ownerId);
  return rowToEdge(r);
}

export function edgesFrom(fromMemoryId: string, ownerId: string): MemoryEdge[] {
  const rows = getDb()
    .prepare("SELECT * FROM memory_edges WHERE from_memory_id = ? AND owner_id = ?")
    .all(fromMemoryId, ownerId) as Record<string, unknown>[];
  return rows.map(rowToEdge);
}

export function deleteEdgesForMemory(memoryId: string, ownerId: string): void {
  // Decrement graph degree for connected nodes before deleting
  const connected = getDb()
    .prepare("SELECT DISTINCT CASE WHEN from_memory_id = ? THEN to_memory_id ELSE from_memory_id END as peer FROM memory_edges WHERE owner_id = ? AND (from_memory_id = ? OR to_memory_id = ?)")
    .all(memoryId, ownerId, memoryId, memoryId) as { peer: string }[];
  for (const { peer } of connected) {
    getDb().prepare("UPDATE memories SET graph_degree = MAX(0, graph_degree - 1) WHERE id = ? AND owner_id = ?").run(peer, ownerId);
  }
  getDb()
    .prepare("DELETE FROM memory_edges WHERE owner_id = ? AND (from_memory_id = ? OR to_memory_id = ?)")
    .run(ownerId, memoryId, memoryId);
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
    .prepare("SELECT * FROM memory_revisions WHERE memory_id = ? AND owner_id = ? ORDER BY created_at ASC")
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

export function recordAudit(entry: Omit<MemoryAuditEntry, "id" | "createdAt">): void {
  getDb()
    .prepare(
      `INSERT INTO memory_audit (id, owner_id, actor, action, target_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), entry.ownerId, entry.actor, entry.action, entry.targetId, entry.reason ?? null, now());
}

// ---- jobs ----

export interface JobRow {
  id: string;
  ownerId: string;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
}

export function claimJob(kind: string): JobRow | null {
  const t = now();
  const r = getDb()
    .prepare(
      `SELECT * FROM memory_jobs WHERE kind = ? AND status = 'pending' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY created_at ASC LIMIT 1`,
    )
    .get(kind, t) as Record<string, unknown> | undefined;
  if (!r) return null;
  getDb()
    .prepare("UPDATE memory_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?")
    .run(t, String(r.id));
  return {
    id: String(r.id),
    ownerId: String(r.owner_id),
    kind: String(r.kind),
    status: "running",
    payload: parseJson(String(r.payload), {}),
  };
}

export function finishJob(id: string, ok: boolean, error?: string): void {
  getDb()
    .prepare("UPDATE memory_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
    .run(ok ? "done" : "failed", error ?? null, now(), id);
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
    .prepare("SELECT * FROM skills WHERE owner_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT ?")
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
