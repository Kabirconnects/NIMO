// workers/dreamer.worker.ts
// The Dreamer: offline memory consolidation — runs while the agent is idle,
// like sleep consolidation in the brain. Three jobs:
//
//   1. Merge near-duplicate memories (same type, high keyword overlap)
//   2. Prune weak edges (confidence < threshold, low weight → delete)
//   3. Re-rank skills by recent usage (ageing + success rate)
//
// All operations are idempotent, audited, and never delete provenance.
// Merged memories keep their revision history; superseded neurons are
// marked, not destroyed. Weak edges are only pruned when they have never
// been reinforced (weight stays low) and carry no evidence.

import { getDb, listActiveMemories, findMemory, updateMemory, insertRevision, recordAudit, edgesFrom } from "../storage/db.js";
import type { MemoryNode } from "../domain/memory.types.js";
import type { MemoryEdge } from "../domain/memory-edge.types.js";
import { skillLifecycle } from "../skills/distill.js";
import type { Skill } from "../domain/skill.types.js";

export interface DreamerResult {
  merged: number;
  pruned: number;
  reRanked: number;
  promoted: number;
  demoted: number;
  archived: number;
}

function keywordOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a.map((k) => k.toLowerCase()));
  const setB = new Set(b.map((k) => k.toLowerCase()));
  const union = new Set([...setA, ...setB]);
  const inter = [...setA].filter((x) => setB.has(x)).length;
  return inter / Math.max(1, union.size);
}

function contentSimilarity(a: string, b: string): number {
  const normalized = (s: string) =>
    s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9\s]/g, "").trim();
  const na = normalized(a);
  const nb = normalized(b);
  if (na === nb) return 1;
  if (na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))) return 0.95;
  // Token overlap as a proxy for semantic similarity (deterministic, no model)
  const wordsA = new Set(na.split(" ").filter((w) => w.length >= 3));
  const wordsB = new Set(nb.split(" ").filter((w) => w.length >= 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const inter = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return inter / union;
}

/**
 * Merge near-duplicate memories: same type + content similarity >= 0.8
 * (or keyword overlap >= 0.6 with same type). Keeps the more recent /
 * more important neuron as canonical, appends evidence from the other,
 * and marks the duplicate as superseded (not deleted).
 */
function mergeNearDuplicates(ownerId: string): number {
  const active = listActiveMemories(ownerId, { limit: 500 });
  let merged = 0;
  const mergedIds = new Set<string>();

  // Sort by importance desc so canonical survives
  const sorted = [...active].sort((a, b) => b.importance - a.importance || b.updatedAt.getTime() - a.updatedAt.getTime());

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (mergedIds.has(a.id) || a.status !== "active") continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (mergedIds.has(b.id) || b.status !== "active") continue;
      if (a.type !== b.type) continue;

      const sim = contentSimilarity(a.content, b.content);
      const kwOverlap = keywordOverlap(a.keywords, b.keywords);
      const isDup = sim >= 0.8 || (kwOverlap >= 0.6 && sim >= 0.6);

      if (isDup) {
        // Merge b's evidence into a, mark b superseded
        const mergedEvidence = [...a.evidence, ...b.evidence];
        const aAfter = updateMemory(a.id, ownerId, {
          evidence: mergedEvidence,
          confidence: Math.min(1, Math.max(a.confidence, b.confidence)),
          importance: Math.min(1, Math.max(a.importance, b.importance)),
          keywords: [...new Set([...a.keywords, ...b.keywords])],
          concepts: [...new Set([...a.concepts, ...b.concepts])],
        });
        if (aAfter) {
          insertRevision({
            memoryId: a.id,
            ownerId,
            previousContent: a.content,
            newContent: b.content,
            reason: "consolidation",
            evidenceIds: b.evidence.map((e) => e.experienceId),
          });
        }
        // Mark b as superseded by a (preserve history, don't delete)
        updateMemory(b.id, ownerId, {
          status: "superseded",
          supersededBy: a.id,
        });
        mergedIds.add(b.id);
        merged++;
        recordAudit({
          ownerId,
          actor: "worker",
          action: "merge",
          targetId: b.id,
          reason: `dreamer merged duplicate into ${a.id}`,
        });
      }
    }
  }
  return merged;
}

/**
 * Prune weak edges: confidence < 0.3 AND weight < 0.2 AND no evidence.
 * These are connections the system never validated — they add noise to
 * graph activation without carrying meaning.
 */
function pruneWeakEdges(ownerId: string): number {
  const db = getDb();
  // Find all edges for this owner
  const rows = db.prepare("SELECT * FROM memory_edges WHERE owner_id = ?").all(ownerId) as Record<string, unknown>[];
  let pruned = 0;

  for (const r of rows) {
    const confidence = Number(r.confidence);
    const weight = Number(r.weight);
    const evidenceIds = JSON.parse(String(r.evidence_ids ?? "[]")) as string[];

    if (confidence < 0.3 && weight < 0.2 && evidenceIds.length === 0) {
      db.prepare("DELETE FROM memory_edges WHERE id = ?").run(String(r.id));
      pruned++;
    }
  }

  if (pruned > 0) {
    recordAudit({
      ownerId,
      actor: "worker",
      action: "update",
      targetId: "edges",
      reason: `dreamer pruned ${pruned} weak edges`,
    });
  }
  return pruned;
}

/**
 * Re-rank skills using the lifecycle rules: promote candidates with success,
 * demote mediocre ones, archive harmful ones. Updates confidence based on
 * recorded use/success/failure counts.
 */
function reRankSkills(ownerId: string): { promoted: number; demoted: number; archived: number; reRanked: number } {
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM skills WHERE owner_id = ? AND status IN ('candidate', 'active')"
  ).all(ownerId) as Record<string, unknown>[];

  let promoted = 0, demoted = 0, archived = 0, reRanked = 0;

  for (const r of rows) {
    const skill: Skill = {
      id: String(r.id),
      ownerId: String(r.owner_id),
      name: String(r.name),
      whenToUse: String(r.when_to_use),
      steps: JSON.parse(String(r.steps)) as string[],
      toolsUsed: JSON.parse(String(r.tools_used)) as string[],
      examples: JSON.parse(String(r.examples)) as string[],
      keywords: JSON.parse(String(r.keywords)) as string[],
      tags: JSON.parse(String(r.tags)) as string[],
      useCount: Number(r.use_count),
      successCount: Number(r.success_count),
      failureCount: Number(r.failure_count),
      confidence: Number(r.confidence),
      importance: Number(r.importance),
      status: String(r.status) as Skill["status"],
      createdAt: new Date(Number(r.created_at)),
      updatedAt: new Date(Number(r.updated_at)),
      lastAccessedAt: r.last_accessed_at ? new Date(Number(r.last_accessed_at)) : undefined,
    };

    const action = skillLifecycle(skill);
    if (action === "promote") {
      db.prepare("UPDATE skills SET status = 'active', updated_at = ? WHERE id = ? AND owner_id = ?")
        .run(Date.now(), skill.id, ownerId);
      promoted++;
      recordAudit({ ownerId, actor: "worker", action: "update", targetId: skill.id, reason: `dreamer promoted ${skill.name}` });
    } else if (action === "archive") {
      db.prepare("UPDATE skills SET status = 'archived', updated_at = ? WHERE id = ? AND owner_id = ?")
        .run(Date.now(), skill.id, ownerId);
      archived++;
      recordAudit({ ownerId, actor: "worker", action: "archive", targetId: skill.id, reason: `dreamer archived ${skill.name} (harmful)` });
    } else if (action === "demote") {
      db.prepare("UPDATE skills SET status = 'candidate', updated_at = ? WHERE id = ? AND owner_id = ?")
        .run(Date.now(), skill.id, ownerId);
      demoted++;
      recordAudit({ ownerId, actor: "worker", action: "update", targetId: skill.id, reason: `dreamer demoted ${skill.name}` });
    }

    // Recompute confidence from track record (if enough uses)
    if (skill.useCount >= 3) {
      const newConf = skill.successCount / skill.useCount;
      if (Math.abs(newConf - skill.confidence) > 0.01) {
        db.prepare("UPDATE skills SET confidence = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
          .run(newConf, Date.now(), skill.id, ownerId);
        reRanked++;
      }
    }
  }

  return { promoted, demoted, archived, reRanked };
}

/**
 * Run one Dreamer cycle for the given owner. Safe to call repeatedly;
 * idempotent by design. Returns summary of what happened.
 */
export function runDreamer(ownerId: string): DreamerResult {
  const merged = mergeNearDuplicates(ownerId);
  const pruned = pruneWeakEdges(ownerId);
  const skillResult = reRankSkills(ownerId);

  return {
    merged,
    pruned,
    reRanked: skillResult.reRanked,
    promoted: skillResult.promoted,
    demoted: skillResult.demoted,
    archived: skillResult.archived,
  };
}
