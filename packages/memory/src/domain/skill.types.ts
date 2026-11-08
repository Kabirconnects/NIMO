// domain/skill.types.ts
// Skills are the unit of learning — a procedure that has *worked* before,
// with evidence from experience. A memory remembers what happened; a skill
// remembers how to do it again, and its weight is its track record.

export type SkillStatus = "candidate" | "active" | "archived" | "deleted";

export interface Skill {
  id: string;
  ownerId: string;

  /** Short name, e.g. "commit-fix". */
  name: string;
  /** When to load this skill — one line the retriever matches against. */
  whenToUse: string;
  /** The exact steps, in order. */
  steps: string[];
  /** Tools that were involved in the proven attempt. */
  toolsUsed: string[];
  /** Worked examples (quotes/stories). */
  examples: string[];

  /** A project, topic, or command it applies to. */
  keywords: string[];
  tags: string[];

  /** Human-like evidence of success/rehearsal. Starts small, grows with use. */
  useCount: number;
  successCount: number;
  failureCount: number;

  confidence: number; // 0..1 — derived from successes / uses
  importance: number; // 0..1 — researcher-taught primitives score high

  status: SkillStatus;

  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
}

export interface CreateSkillInput {
  ownerId: string;
  name: string;
  whenToUse: string;
  steps: string[];
  toolsUsed?: string[];
  examples?: string[];
  keywords?: string[];
  tags?: string[];
  confidence?: number;
  importance?: number;
}

export interface SkillOutcome {
  success: boolean;
  evidence?: string;
}
