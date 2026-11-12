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
  ForgetByQueryOptions,
  ForgetByQueryResult,
} from "./domain/service.types.js";
import type { MemoryNode } from "./domain/memory.types.js";
import type { MemoryRevision } from "./domain/governance.types.js";
import { ingest } from "./ingestion/ingest.js";
import { recall } from "./retrieval/search.js";
import { forgetMemory, forgetByQuery as forgetByQueryImpl } from "./governance/forget.js";
import {
  evaluateWrite,
  DEFAULT_POLICY,
  detectSecret,
  redactSecrets,
} from "./governance/policy.js";
import { isDenial } from "./ingestion/validate.js";
import { stemsOverlap, isCommonWord } from "./retrieval/embed.js";
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
  withTransaction,
} from "./storage/db.js";

/** A write was rejected by governance (secret, denial, forbidden field). */
export class MemoryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryPolicyError";
  }
}

function assertWritableText(label: string, text: string | undefined): void {
  if (!text) return;
  const gate = evaluateWrite("create", text, DEFAULT_POLICY);
  if (gate.decision === "deny") {
    throw new MemoryPolicyError(`${label}: ${gate.reason}`);
  }
}

function assertNotDenial(text: string): void {
  if (isDenial(text)) {
    throw new MemoryPolicyError(
      "Agent denials (\"I do not have...\") are not durable memories — not stored.",
    );
  }
}

/** All human-visible fields that must pass the secret gate before a write. */
function textFields(input: {
  content?: string;
  summary?: string;
  whenToUse?: string;
  name?: string;
  steps?: string[];
  keywords?: string[];
  tags?: string[];
  concepts?: string[];
}): string {
  return [
    input.content,
    input.summary,
    input.whenToUse,
    input.name,
    ...(input.steps ?? []),
    ...(input.keywords ?? []),
    ...(input.tags ?? []),
    ...(input.concepts ?? []),
  ]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join("\n");
}

export const memoryService: MemoryService = {
  remember(input: IngestExperienceInput): IngestionResult {
    return ingest(input);
  },

  createMemory(input: CreateMemoryInput): MemoryNode {
    assertWritableText("memory", textFields({
      content: input.content,
      summary: input.summary,
      keywords: input.keywords,
      tags: input.tags,
      concepts: input.concepts,
    }));
    assertNotDenial(input.content);

    return withTransaction(() => {
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
    });
  },

  recall(input: RecallInput): RecallResult {
    return recall(input);
  },

  update(memoryId: string, ownerId: string, changes: Partial<MemoryNode>): MemoryNode {
    const before = findMemory(memoryId, ownerId);
    if (!before) throw new MemoryPolicyError(`Memory ${memoryId} not found for owner ${ownerId}`);

    // Deletion has one path only (forget). Updates cannot fake it.
    if (changes.status === "deleted") {
      throw new MemoryPolicyError("Use forget() to delete a memory; update() cannot mark it deleted.");
    }

    const nextText = textFields({
      content: changes.content,
      summary: changes.summary,
      keywords: changes.keywords,
      tags: changes.tags,
      concepts: changes.concepts,
    });
    assertWritableText("update", nextText);
    if (changes.content !== undefined) assertNotDenial(changes.content);

    return withTransaction(() => {
      const after = updateMemoryRow(memoryId, ownerId, changes);
      if (!after) throw new MemoryPolicyError(`Memory ${memoryId} not found for owner ${ownerId}`);

      // Preserve the version history — never silently rewrite. If the older
      // body predates the current secret scanner, redact it before archiving.
      insertRevision({
        memoryId,
        ownerId,
        previousContent: detectSecret(before.content) ? redactSecrets(before.content) : before.content,
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
    });
  },

  forget(memoryId: string, ownerId: string): void {
    forgetMemory(memoryId, ownerId);
  },

  forgetByQuery(
    ownerId: string,
    query: string,
    options: ForgetByQueryOptions = {},
  ): ForgetByQueryResult {
    return forgetByQueryImpl(ownerId, query, options);
  },

  linkMemories(
    fromMemoryId: string,
    toMemoryId: string,
    ownerId: string,
    relation: import("./domain/memory-edge.types.js").MemoryRelation,
    confidence: number,
    weight: number,
  ): void {
    if (fromMemoryId === toMemoryId) {
      throw new MemoryPolicyError("Cannot link a memory to itself.");
    }
    const from = findMemory(fromMemoryId, ownerId);
    const to = findMemory(toMemoryId, ownerId);
    if (!from || !to) {
      throw new MemoryPolicyError("Cannot link: one or both memories do not exist for this owner.");
    }

    withTransaction(() => {
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
      if (relation === "supersedes" && to.status === "active") {
        updateMemoryRow(toMemoryId, ownerId, {
          status: "superseded",
          supersededBy: fromMemoryId,
        });
        insertRevision({
          memoryId: toMemoryId,
          ownerId,
          previousContent: detectSecret(to.content) ? redactSecrets(to.content) : to.content,
          newContent: to.content,
          reason: "supersession",
          evidenceIds: [],
        });
      }
      recordAudit({
        ownerId,
        actor: "agent",
        action: "link",
        targetId: toMemoryId,
        reason: `${fromMemoryId} -[${relation}]-> ${toMemoryId}`,
      });
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
    assertWritableText("teach", textFields({
      content: input.content,
      summary: input.summary,
      keywords: input.keywords,
      tags: input.tags,
      concepts: input.concepts,
    }));
    assertNotDenial(input.content);

    const keywords = [...new Set([
      ...(input.keywords ?? []),
      ...(input.topic ? input.topic.toLowerCase().split(/\W+/).filter((w) => w.length >= 3) : []),
    ])];
    return withTransaction(() => {
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
    });
  },

  createSkill(input: import("./domain/skill.types.js").CreateSkillInput): import("./domain/skill.types.js").Skill {
    assertWritableText("skill", textFields({
      name: input.name,
      whenToUse: input.whenToUse,
      steps: input.steps,
      keywords: input.keywords,
      tags: input.tags,
    }));
    return withTransaction(() => insertSkill(input));
  },

  loadSkills(ownerId: string, query: string, limit = 5): import("./domain/skill.types.js").Skill[] {
    // Include candidates so newly autonomous skills can fire immediately.
    const skills = listActiveSkills(ownerId, 100);
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length >= 3 && !isCommonWord(t));
    const scored = skills.map((s) => {
      const hay = [s.name, s.whenToUse, ...s.keywords, ...s.tags, ...s.steps].join(" ").toLowerCase();
      const hayWords = (hay.match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length >= 3 && !isCommonWord(w));
      let hits = 0;
      for (const t of terms) {
        if (hayWords.some((w) => w.length >= 3 && stemsOverlap(t, w))) hits++;
      }
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
    if (!before) throw new MemoryPolicyError(`Skill ${skillId} not found for owner ${ownerId}`);
    const useCount = before.useCount + 1;
    const successCount = before.successCount + (outcome.success ? 1 : 0);
    const failureCount = before.failureCount + (outcome.success ? 0 : 1);
    const confidence = Math.min(1, Math.max(0, useCount > 0 ? successCount / useCount : before.confidence));
    // First success promotes the skill to active — rehearsal confirms it.
    const status = before.status === "candidate" && outcome.success ? "active" : before.status;
    return withTransaction(() => {
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
    });
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
    const gate = evaluateWrite(
      "create",
      textFields({ name: skillInput.name, whenToUse: skillInput.whenToUse, steps: skillInput.steps }),
      DEFAULT_POLICY,
    );
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
