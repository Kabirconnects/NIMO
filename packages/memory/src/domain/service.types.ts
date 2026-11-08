// domain/service.types.ts
// The public contract of the memory engine. Agents and the server depend on
// THIS interface, never on storage internals.

import type { MemoryNode, MemoryType, MemoryEvidence } from "./memory.types.js";
import type { MemoryRevision } from "./governance.types.js";
import type { ExperienceType } from "./experience.types.js";
import type { Skill, CreateSkillInput, SkillOutcome } from "./skill.types.js";

// ---- remember (ingest one experience) ----

export interface TeachInput extends CreateMemoryInput {
  /** Optional topic label — used as a keyword + tag so the lesson is retrievable. */
  topic?: string;
}

export interface IngestExperienceInput {
  ownerId: string;
  messageId?: string;
  content: string;
  type: ExperienceType;
  occurredAt?: Date;
}

/** Agent-facing: create a durable memory node directly under governance. */
export interface CreateMemoryInput {
  ownerId: string;
  type: MemoryType;
  content: string;
  summary?: string;
  concepts?: string[];
  keywords?: string[];
  tags?: string[];
  entities?: { name: string; type: string }[];
  confidence?: number;
  importance?: number;
  evidence?: MemoryEvidence[];
}

export interface IngestionResult {
  experienceId: string;
  created: number;
  updated: number;
  merged: number;
  linked: number;
  rejected: number;
  memoryIds: string[];
}

// ---- recall (hybrid retrieval) ----

export interface RecallInput {
  ownerId: string;
  query: string;
  limit?: number;
  maxGraphHops?: number;
  memoryTypes?: MemoryType[];
  includeEvidence?: boolean;
}

export interface RetrievedMemory {
  memory: MemoryNode;
  score: number;
  matchedBy: ("vector" | "keyword" | "entity" | "graph")[];
  relatedMemoryIds: string[];
  evidence: MemoryEvidence[];
}

export interface RecallResult {
  memories: RetrievedMemory[];
  totalCandidates: number;
  queryConcepts: string[];
  retrievalTimeMs: number;
}

/** Compact, prompt-ready context built from recalled memories. */
export interface MemoryContext {
  memories: RetrievedMemory[];
  formattedContext: string;
  tokenEstimate: number;
}

// ---- the service itself ----

export interface MemoryService {
  remember(input: IngestExperienceInput): IngestionResult;
  createMemory(input: CreateMemoryInput): MemoryNode;
  recall(input: RecallInput): RecallResult;

  update(
    memoryId: string,
    ownerId: string,
    changes: Partial<MemoryNode>,
  ): MemoryNode;

  forget(memoryId: string, ownerId: string): void;
  forgetByQuery(ownerId: string, query: string): number;

  linkMemories(
    fromMemoryId: string,
    toMemoryId: string,
    ownerId: string,
    relation: import("./memory-edge.types.js").MemoryRelation,
    confidence: number,
    weight: number,
  ): void;

  getRelated(memoryId: string, ownerId: string): MemoryNode[];
  getHistory(memoryId: string, ownerId: string): MemoryRevision[];

  /** A flowing, newest-first stream of memories — like how a human recalls
   *  the latest things they did, with no session boundaries. Used by the
   *  agent runtime to always know "what we are doing now". */
  getRecent(ownerId: string, limit?: number): MemoryNode[];
  teach(input: TeachInput): MemoryNode;

  // ---- skills: the unit of learning ----
  createSkill(input: CreateSkillInput): Skill;
  /** Load the skills most relevant to `query` — newest + proven first. */
  loadSkills(ownerId: string, query: string, limit?: number): Skill[];
  /** Record the outcome of using a skill — rehearsal strengthens or fades it. */
  useSkill(skillId: string, ownerId: string, outcome: SkillOutcome): Skill;
  /** Propose a new skill from a raw experience (auto-gap → skill). */
  proposeSkillFromExperience(input: {
    ownerId: string;
    prompt: string;
    response: string;
    toolsUsed: string[];
  }): Skill[];
  /** Promote/demote skills based on outcomes and evidence; returns actions taken. */
  evolveSkills(ownerId: string): { promoted: number; demoted: number; archived: number };
}
