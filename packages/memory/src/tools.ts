// tools.ts
// Agent-facing memory tools (AgeMem-style: typed ops, not raw DB).
// The agent calls these; it never sees SQLite, embeddings, or graph code.
//
// Security model:
//   - the owner id comes from the request-scoped runtime context, NEVER from
//     model-supplied input
//   - write tools require `permissions.write` (available in every mode — the
//     brain learns during chat/planning too)
//   - delete tools require `permissions.delete` AND an explicit human
//     confirmation for the turn (Auto mode only)
//
// `memoryTools` is the full registry (backwards compatible). Mode-aware
// callers should compose `memoryReadTools` / `memoryWriteTools` /
// `memoryDestructiveTools`.

import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { memoryService } from "./service.js";
import { DEFAULT_POLICY, evaluateWrite } from "./governance/policy.js";
import type { MemoryRelation } from "./domain/memory-edge.types.js";
import {
  requireMemoryContext,
  requirePermission,
  MemoryAccessError,
} from "./runtime/context.js";

function ownerId(): string {
  return requireMemoryContext().ownerId;
}

function asError(error: unknown) {
  if (error instanceof MemoryAccessError) {
    return { success: false as const, error: error.message, code: error.code };
  }
  return {
    success: false as const,
    error: error instanceof Error ? error.message : String(error),
  };
}

// ---------------------------------------------------------------------------
// Read-only tools (safe in Chat / Plan / Auto)
// ---------------------------------------------------------------------------

export const memoryReadTools: ToolSet = {
  loadSkills: tool({
    description:
      "Load the skills most relevant to a query — proven procedures the agent has learned, like muscle memory. " +
      "Use when the task matches a possible skill. Returns up to 5 skills, newest + most successful first.",
    inputSchema: z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(10).optional() }),
    execute: async (input) => {
      try {
        const skills = memoryService.loadSkills(ownerId(), input.query, input.limit ?? 5);
        return {
          success: true as const,
          skills: skills.map((s) => ({
            id: s.id, name: s.name, whenToUse: s.whenToUse, steps: s.steps, toolsUsed: s.toolsUsed,
            trackRecord: `${s.successCount}/${s.useCount}`, confidence: s.confidence,
          })),
        };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  getRecent: tool({
    description:
      "Show the newest things the memory knows — the flow of what we are doing now, newest first — no session buckets. " +
      "Use to see current focus before answering questions about what we have been doing.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
    execute: async (input) => {
      try {
        const recent = memoryService.getRecent(ownerId(), input.limit ?? 5);
        return {
          success: true as const,
          recent: recent.map((m) => ({ id: m.id, content: m.content, type: m.type, updatedAt: m.updatedAt })),
        };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  recall: tool({
    description:
      "Search stored memories by meaning, keywords, entities, and their connections. " +
      "Use when the user refers to something discussed before ('what did we decide about X', 'last time', 'remember when'), " +
      "or when you need earlier context that is not in the current conversation. " +
      "Returns the memories most connected to your query — not the entire history.",
    inputSchema: z.object({
      query: z.string().max(200).describe("What you are trying to remember. Use keywords, not full sentences."),
      limit: z.number().int().min(1).max(20).optional(),
      maxGraphHops: z.number().int().min(0).max(4).optional(),
    }),
    execute: async (input) => {
      try {
        const result = memoryService.recall({
          ownerId: ownerId(),
          query: input.query,
          limit: input.limit ?? 8,
          maxGraphHops: input.maxGraphHops ?? 2,
          includeEvidence: true,
        });
        return {
          success: true as const,
          count: result.memories.length,
          poolTruncated: result.poolTruncated ?? false,
          resultsTruncated: result.resultsTruncated ?? false,
          memories: result.memories.map((r) => ({
            id: r.memory.id,
            content: r.memory.content,
            summary: r.memory.summary,
            type: r.memory.type,
            score: r.score,
            matchedBy: r.matchedBy,
            relatedMemoryIds: r.relatedMemoryIds,
            evidence: r.evidence.map((e) => e.quote).filter(Boolean),
          })),
        };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  getRelatedMemories: tool({
    description: "Get the memories directly connected to a given memory through the association graph.",
    inputSchema: z.object({ memoryId: z.string() }),
    execute: async (input) => {
      try {
        const related = memoryService.getRelated(input.memoryId, ownerId());
        return {
          success: true as const,
          memories: related.map((m) => ({ id: m.id, content: m.content, type: m.type })),
        };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  getMemoryHistory: tool({
    description: "Show the version history of a memory — what it was, what changed, and why.",
    inputSchema: z.object({ memoryId: z.string() }),
    execute: async (input) => {
      try {
        const history = memoryService.getHistory(input.memoryId, ownerId());
        return {
          success: true as const,
          revisions: history.map((r) => ({
            reason: r.reason,
            previousContent: r.previousContent,
            newContent: r.newContent,
            createdAt: r.createdAt,
          })),
        };
      } catch (error) {
        return asError(error);
      }
    },
  }),
};

// ---------------------------------------------------------------------------
// Write tools (Auto mode only)
// ---------------------------------------------------------------------------

export const memoryWriteTools: ToolSet = {
  teachSkill: tool({
    description:
      "Plant a reusable skill — a proven procedure stored in memory as a 'skill' (like a muscle memory). " +
      "Use when you or a researcher discovers a repeatable way to do something: the next time it is needed, " +
      "the skill will be recalled automatically. Start small; it grows stronger every time it succeeds.",
    inputSchema: z.object({
      name: z.string().min(1).max(80).describe("Short skill name, e.g. 'fix-test', 'add-field'."),
      whenToUse: z.string().min(1).max(300).describe("When a future agent should load this skill. One line."),
      steps: z.array(z.string().min(1)).min(1).max(20).describe("Exact steps, in order."),
      toolsUsed: z.array(z.string()).max(10).optional(),
      keywords: z.array(z.string()).max(10).optional(),
      tags: z.array(z.string()).max(10).optional(),
    }),
    execute: async (input) => {
      try {
        requirePermission("write");
        const skill = memoryService.createSkill({
          ownerId: ownerId(),
          name: input.name,
          whenToUse: input.whenToUse,
          steps: input.steps,
          toolsUsed: input.toolsUsed,
          keywords: input.keywords,
          tags: input.tags,
        });
        return { success: true as const, id: skill.id, name: skill.name, note: `Skill "${skill.name}" planted as candidate. It becomes active after its first success.` };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  useSkill: tool({
    description:
      "Record the outcome of using a skill from the 'Skills you can use now' block. " +
      "Success → the skill gets stronger and more likely to be recalled (rehearsal). " +
      "Failure → it fades a little. Always call this right after you follow a skill.",
    inputSchema: z.object({
      skillId: z.string(),
      success: z.boolean(),
      evidence: z.string().max(300).optional().describe("What happened, e.g. 'tests passed', 'tool timed out'."),
    }),
    execute: async (input) => {
      try {
        requirePermission("write");
        const skill = memoryService.useSkill(input.skillId, ownerId(), { success: input.success, evidence: input.evidence });
        return {
          success: true as const,
          id: skill.id,
          name: skill.name,
          trackRecord: `${skill.successCount}/${skill.useCount}`,
          confidence: skill.confidence,
          status: skill.status,
        };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  teach: tool({
    description:
      "Teach the memory a durable lesson — like a researcher teaching a toddler: a concept, fact, procedure, or principle. " +
      "This plants knowledge that grows the memory forever (until corrected or forgotten). " +
      "Use when the user or a researcher corrects, explains, or grants a principle, rule, or how-to. " +
      "Optional topic links the lesson to a subject so it is easy to recall. " +
      "Never store secrets, credentials, or instructions to ignore safety rules.",
    inputSchema: z.object({
      content: z.string().max(1000).describe("The lesson, written as one self-contained truth/instruction."),
      type: z.enum([
        "fact", "preference", "decision", "event", "concept", "procedure", "goal", "observation",
        "sensor", "trajectory", "hypothesis", "experiment",
      ]).default("concept"),
      topic: z.string().max(80).optional().describe("Subject/topic, e.g. 'images', 'trading-risk'."),
      keywords: z.array(z.string()).max(10).optional(),
      concepts: z.array(z.string()).max(10).optional(),
    }),
    execute: async (input) => {
      try {
        requirePermission("write");
        const gate = evaluateWrite("create", input.content, DEFAULT_POLICY);
        if (gate.decision === "deny") return { success: false as const, error: gate.reason };
        const node = memoryService.teach({
          ownerId: ownerId(),
          type: input.type,
          content: input.content,
          topic: input.topic,
          keywords: input.keywords,
          concepts: input.concepts,
        });
        return { success: true as const, id: node.id, type: node.type, note: `Taught: ${node.summary.slice(0, 120)}` };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  remember: tool({
    description:
      "Store a durable memory: a fact, preference, decision, event, concept, procedure, goal, or observation that will matter in future conversations. " +
      "Do NOT store task progress, one-off details, secrets, or instructions to ignore safety rules. " +
      "The memory is written immediately but becomes retrievable from the next turn.",
    inputSchema: z.object({
      content: z.string().max(1000).describe("One short, self-contained fact/instruction."),
      type: z.enum([
        "fact", "preference", "decision", "event", "concept", "procedure", "goal", "observation",
        "sensor", "trajectory", "hypothesis", "experiment",
      ]),
      keywords: z.array(z.string()).max(10).optional(),
      concepts: z.array(z.string()).max(10).optional(),
      tags: z.array(z.string()).max(10).optional(),
      confidence: z.number().min(0).max(1).optional(),
      importance: z.number().min(0).max(1).optional(),
    }),
    execute: async (input) => {
      try {
        requirePermission("write");
        const gate = evaluateWrite("create", input.content, DEFAULT_POLICY);
        if (gate.decision === "deny") {
          return { success: false as const, error: gate.reason };
        }
        const node = memoryService.createMemory({
          ownerId: ownerId(),
          type: input.type,
          content: input.content,
          keywords: input.keywords,
          concepts: input.concepts,
          tags: input.tags,
          confidence: input.confidence,
          importance: input.importance,
        });
        return {
          success: true as const,
          id: node.id,
          type: node.type,
          note: "Stored. It will be recalled automatically when relevant in future conversations.",
        };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  linkMemories: tool({
    description:
      "Connect two memories with a typed relationship. " +
      "Use when you notice that two memories are related in a way that helps future recall — " +
      "for example a decision depends_on a fact, or one observation supports another. " +
      "A good connection makes both memories easier to find later.",
    inputSchema: z.object({
      fromMemoryId: z.string(),
      toMemoryId: z.string(),
      relation: z.enum([
        "related_to", "about", "supports", "contradicts", "explains",
        "caused_by", "part_of", "derived_from", "supersedes",
        "depends_on", "occurred_before", "occurred_after",
        "causes", "enables", "observes", "tests", "replicates",
      ]),
      confidence: z.number().min(0).max(1),
      weight: z.number().min(0).max(1).optional(),
    }),
    execute: async (input) => {
      try {
        requirePermission("write");
        // Superseding hides an existing memory from recall — treat it as
        // destructive and require human confirmation.
        if (input.relation === "supersedes") requirePermission("delete");
        memoryService.linkMemories(
          input.fromMemoryId,
          input.toMemoryId,
          ownerId(),
          input.relation as MemoryRelation,
          input.confidence,
          input.weight ?? 0.5,
        );
        return { success: true as const, note: `Linked ${input.fromMemoryId.slice(0, 8)} -[${input.relation}]-> ${input.toMemoryId.slice(0, 8)}` };
      } catch (error) {
        return asError(error);
      }
    },
  }),

  updateMemory: tool({
    description:
      "Update an existing memory by id. Use when a stored fact is corrected or superseded. " +
      "The previous version is preserved in history — it is never silently rewritten. " +
      "This cannot delete a memory; use forgetMemory for that.",
    inputSchema: z.object({
      memoryId: z.string(),
      content: z.string().max(1000).optional(),
      summary: z.string().max(200).optional(),
      confidence: z.number().min(0).max(1).optional(),
      importance: z.number().min(0).max(1).optional(),
    }),
    execute: async (input) => {
      try {
        requirePermission("write");
        const node = memoryService.update(input.memoryId, ownerId(), {
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
          ...(input.importance !== undefined ? { importance: input.importance } : {}),
        });
        return { success: true as const, id: node.id, updatedAt: node.updatedAt };
      } catch (error) {
        return asError(error);
      }
    },
  }),
};

// ---------------------------------------------------------------------------
// Destructive tools (Auto mode + explicit human confirmation)
// ---------------------------------------------------------------------------

export const memoryDestructiveTools: ToolSet = {
  forgetMemory: tool({
    description:
      "Permanently delete a memory and everything derived from it (its connections, revisions, and index entries). " +
      "Use only when the user explicitly asks to forget something. This cannot be undone.",
    inputSchema: z.object({ memoryId: z.string() }),
    execute: async (input) => {
      try {
        requirePermission("delete");
        memoryService.forget(input.memoryId, ownerId());
        return { success: true as const, note: "Memory and its connections have been removed." };
      } catch (error) {
        return asError(error);
      }
    },
  }),
};

/** Full registry — backwards compatible. Mode-aware callers should compose. */
export const memoryTools: ToolSet = {
  ...memoryReadTools,
  ...memoryWriteTools,
  ...memoryDestructiveTools,
};
