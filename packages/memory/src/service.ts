// service.ts
// The MemoryService implementation — wiring ingestion, retrieval, and
// governance together behind the domain interface. Storage is local SQLite
// (storage/db.ts); nothing here knows about SQL.

import type {
  IngestionResult,
  IngestExperienceInput,
  MemoryService,
  RecallInput,
  RecallResult,
  CreateMemoryInput,
} from "./domain/service.types.js";
import type { MemoryNode } from "./domain/memory.types.js";
import type { MemoryRevision } from "./domain/governance.types.js";
import { ingest } from "./ingestion/ingest.js";
import { recall } from "./retrieval/search.js";
import { forgetMemory } from "./governance/forget.js";
import { evaluateWrite, DEFAULT_POLICY } from "./governance/policy.js";
import { isDenial } from "./ingestion/validate.js";
import { distillSkill, skillLifecycle } from "./skills/distill.js";
import {
  findMemory,
  updateMemory as updateMemoryRow,
  insertRevision,
  revisionsFor,
  recordAudit,
  edgesFrom,
  insertMemory,
  insertEdge,
  listActiveMemories,
  insertSkill,
  findSkill,
  listActiveSkills,
  updateSkill,
} from "./storage/db.js";

export const memoryService: MemoryService = {
  remember(input: IngestExperienceInput): IngestionResult {
    return ingest(input);
  },

  createMemory(input: CreateMemoryInput): MemoryNode {
    const gate = evaluateWrite("create", input.content, DEFAULT_POLICY);
    if (gate.decision === "deny") throw new Error(gate.reason);
    if (isDenial(input.content)) {
      // createMemory is an explicit caller instruction (benchmark corpus,
      // agent tool "remember") — denial *content* of the agent's own
      // state is not durable knowledge, so drop it loudly instead of
      // silently inserting a node that poisons recall.
      throw new Error("Agent denials (\"I do not have...\") are not durable memories — not stored.");
    }

    const node = insertMemory({
      ownerId: input.ownerId,
      type: input.type,
      status: "active",
      visibility: DEFAULT_POLICY.defaultVisibility,
      content: input.content,
      summary: input.summary ?? input.content.slice(0, 120),
      concepts: input.concepts ?? [],
      keywords: input.keywords ?? [],
      tags: input.tags ?? [],
      entities: input.entities ?? [],
      confidence: input.confidence ?? 0.7,
      importance: input.importance ?? 0.5,
      retentionClass: input.type === "preference" || input.type === "decision" ? "stable" : "volatile",
      evidence: input.evidence ?? [],
      supersedes: [],
    });

    recordAudit({
      ownerId: input.ownerId,
      actor: "agent",
      action: "create",
      targetId: node.id,
      reason: `created ${node.type}`,
    });

    return node;
  },

  recall(input: RecallInput): RecallResult {
    return recall(input);
  },

  update(memoryId: string, ownerId: string, changes: Partial<MemoryNode>): MemoryNode {
    const before = findMemory(memoryId, ownerId);
    if (!before) throw new Error(`Memory ${memoryId} not found for owner ${ownerId}`);

    const after = updateMemoryRow(memoryId, ownerId, changes);
    if (!after) throw new Error(`Memory ${memoryId} not found for owner ${ownerId}`);

    // Preserve the version history — never silently rewrite.
    insertRevision({
      memoryId,
      ownerId,
      previousContent: before.content,
      newContent: after.content,
      reason: "consolidation",
      evidenceIds: (after.evidence ?? []).map((e) => e.experienceId),
    });

    recordAudit({
      ownerId,
      actor: "agent",
      action: "update",
      targetId: memoryId,
      reason: "memory updated",
    });

    return after;
  },

  forget(memoryId: string, ownerId: string): void {
    forgetMemory(memoryId, ownerId);
  },

  forgetByQuery(ownerId: string, query: string): number {
    const result = recall({ ownerId, query, limit: 50 });
    let n = 0;
    for (const { memory } of result.memories) {
      forgetMemory(memory.id, ownerId);
      n++;
    }
    return n;
  },

  linkMemories(
    fromMemoryId: string,
    toMemoryId: string,
    ownerId: string,
    relation: import("./domain/memory-edge.types.js").MemoryRelation,
    confidence: number,
    weight: number,
  ): void {
    insertEdge({
      ownerId,
      fromMemoryId,
      toMemoryId,
      relation,
      confidence,
      weight,
      evidenceIds: [],
    });
    // Supersession is a status change, not just an edge: flip the OLD
    // memory to "superseded" so isRetrievable() hides it from recall.
    // Without this, the old decision (e.g. PostgreSQL) still surfaces
    // alongside the new one — the adaptation-axis "leak" failure.
    if (relation === "supersedes") {
      const before = findMemory(toMemoryId, ownerId);
      if (before && before.status === "active") {
        updateMemoryRow(toMemoryId, ownerId, {
          status: "superseded",
          supersededBy: fromMemoryId,
        });
        insertRevision({
          memoryId: toMemoryId,
          ownerId,
          previousContent: before.content,
          newContent: before.content,
          reason: "supersession",
          evidenceIds: [],
        });
      }
    }
    recordAudit({
      ownerId,
      actor: "agent",
      action: "link",
      targetId: toMemoryId,
      reason: `${fromMemoryId} -[${relation}]-> ${toMemoryId}`,
    });
  },

  getRelated(memoryId: string, ownerId: string): MemoryNode[] {
    const edges = edgesFrom(memoryId, ownerId);
    const out: MemoryNode[] = [];
    for (const e of edges) {
      const n = findMemory(e.toMemoryId, ownerId);
      if (n && n.status === "active") out.push(n);
    }
    return out;
  },

  getHistory(memoryId: string, ownerId: string): MemoryRevision[] {
    return revisionsFor(memoryId, ownerId);
  },

  getRecent(ownerId: string, limit = 5): MemoryNode[] {
    return listActiveMemories(ownerId, { limit });
  },

  teach(input: import("./domain/service.types.js").TeachInput): MemoryNode {
    const gate = evaluateWrite("create", input.content, DEFAULT_POLICY);
    if (gate.decision === "deny") throw new Error(gate.reason);
    const keywords = [...new Set([
      ...(input.keywords ?? []),
      ...(input.topic ? input.topic.toLowerCase().split(/\W+/).filter((w) => w.length >= 3) : []),
    ])];
    const node = insertMemory({
      ownerId: input.ownerId,
      type: input.type,
      status: "active",
      visibility: DEFAULT_POLICY.defaultVisibility,
      content: input.content,
      summary: input.summary ?? input.content.slice(0, 120),
      concepts: input.concepts ?? [],
      keywords,
      tags: [...new Set([...(input.tags ?? []), ...(input.topic ? [`teach:${input.topic}`] : [])])],
      entities: input.entities ?? [],
      confidence: input.confidence ?? 0.85,
      importance: input.importance ?? 0.8,
      retentionClass: "stable", // taught lessons are stable by definition
      evidence: input.evidence ?? [],
      supersedes: [],
    });
    recordAudit({
      ownerId: input.ownerId,
      actor: "agent",
      action: "create",
      targetId: node.id,
      reason: `teach ${node.type}${input.topic ? ` topic=${input.topic}` : ""}`,
    });
    return node;
  },

  createSkill(input: import("./domain/skill.types.js").CreateSkillInput): import("./domain/skill.types.js").Skill {
    const gate = evaluateWrite("create", input.whenToUse + " " + input.steps.join(" "), DEFAULT_POLICY);
    if (gate.decision === "deny") throw new Error(gate.reason);
    return insertSkill(input);
  },

  loadSkills(ownerId: string, query: string, limit = 5): import("./domain/skill.types.js").Skill[] {
    // Include candidates so newly autonomous skills can fire immediately.
    const skills = listActiveSkills(ownerId, 100);
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length >= 3);
    const scored = skills.map((s) => {
      const hay = [s.name, s.whenToUse, ...s.keywords, ...s.tags, ...s.steps].join(" ").toLowerCase();
      let hits = 0;
      for (const t of terms) if (hay.includes(t)) hits++;
      // Success-rate × recency ageing, like a proven neuron fading if unused.
      const last = s.lastAccessedAt?.getTime() ?? s.updatedAt.getTime();
      const ageFactor = 1 / (1 + (Date.now() - last) / (30 * 24 * 60 * 60 * 1000));
      const successRate = s.useCount > 0 ? s.successCount / s.useCount : 0.5;
      const score = (hits / Math.max(1, terms.length)) * 0.6 + successRate * 0.25 * ageFactor + s.confidence * 0.15;
      return { s, score };
    }).filter((x) => x.score > 0);
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.s.updatedAt.getTime() - a.s.updatedAt.getTime(); // newest-first tiebreak
    });
    return scored.slice(0, limit).map((x) => x.s);
  },

  useSkill(skillId: string, ownerId: string, outcome: import("./domain/skill.types.js").SkillOutcome): import("./domain/skill.types.js").Skill {
    const before = findSkill(skillId, ownerId);
    if (!before) throw new Error(`Skill ${skillId} not found for owner ${ownerId}`);
    const useCount = before.useCount + 1;
    const successCount = before.successCount + (outcome.success ? 1 : 0);
    const failureCount = before.failureCount + (outcome.success ? 0 : 1);
    const confidence = Math.min(1, Math.max(0, useCount > 0 ? successCount / useCount : before.confidence));
    // First success promotes the skill to active — rehearsal confirms it.
    const status = before.status === "candidate" && outcome.success ? "active" : before.status;
    const after = updateSkill(skillId, ownerId, {
      status,
      useCount,
      successCount,
      failureCount,
      confidence,
      lastAccessedAt: new Date(),
    })!;
    recordAudit({
      ownerId,
      actor: "agent",
      action: "update",
      targetId: skillId,
      reason: `skill ${outcome.success ? "succeeded" : "failed"} — ${outcome.evidence ?? ""}`.trim(),
    });
    return after;
  },

  proposeSkillFromExperience(input: {
    ownerId: string;
    prompt: string;
    response: string;
    toolsUsed: string[];
  }): import("./domain/skill.types.js").Skill[] {
    const skillInput = distillSkill(input);
    if (!skillInput) return [];
    // Don't duplicate a skill we already have for this gap.
    const existing = listActiveSkills(input.ownerId, 200);
    const dup = existing.some(
      (s) => s.name === skillInput.name && s.whenToUse === skillInput.whenToUse,
    );
    if (dup) return [];
    const gate = evaluateWrite("create", skillInput.whenToUse + " " + skillInput.steps.join(" "), DEFAULT_POLICY);
    if (gate.decision === "deny") return [];
    return [insertSkill(skillInput)];
  },

  evolveSkills(ownerId: string): { promoted: number; demoted: number; archived: number } {
    const all = listActiveSkills(ownerId, 500);
    let promoted = 0, demoted = 0, archived = 0;
    for (const s of all) {
      const action = skillLifecycle(s);
      if (action === "promote") { updateSkill(s.id, ownerId, { status: "active" }); promoted++; }
      else if (action === "archive") { updateSkill(s.id, ownerId, { status: "archived" }); archived++; }
      else if (action === "demote") { updateSkill(s.id, ownerId, { status: "candidate" }); demoted++; }
    }
    return { promoted, demoted, archived };
  },
};
