// workers/curiosity.ts
// The Curiosity Drive: motivates autonomous exploration of unvisited skills
// and sensorimotor trajectories. Based on intrinsic motivation research
// (Oudeyer & Kaplan, 2007) and UCB bandit exploration (Auer et al., 2002).
//
// Why exploration matters for AGI:
//   A robot that only does what it already knows never discovers new gaits.
//   A lab agent that never tries new protocols never discovers new science.
//   Curiosity is the drive to try the unknown when exploits are safe.
//
// Formula:
//   curiosity_score = unexplored_bonus * recency_factor * novelty_factor
//   unexplored_bonus = sqrt(2 * ln(t_total + 1) / (n_arm + 1))
//   recency_factor = 1 / (1 + age_days / 30)   // fresher = more curious
//   novelty_factor = 1.0 if never tried, else 0.5
//
// Combined with exploitation (UCB mean from bandit.ts):
//   total_score = exploit_score + curiosity_weight * curiosity_score

import type { Skill } from "../domain/skill.types.js";
import { pickBest, ucbScore } from "../skills/bandit.js";
import type { BanditArm } from "../skills/bandit.js";

export interface CuriosityArm extends BanditArm {
  lastBumpedAt?: Date;
  createdAt: Date;
}

export interface CuriosityBudget {
  /** Fraction of choices that should be exploratory vs exploitative (0-1). */
  curiosityRate: number;
  /** Max unused days before an arm becomes "novel" again. */
  noveltyWindowDays: number;
}

export const DEFAULT_CURIOSITY: CuriosityBudget = {
  curiosityRate: 0.25,  // ~25% exploration, ~75% exploitation
  noveltyWindowDays: 30,
};

/**
 * Compute curiosity bonus for a single arm.
 * Uses UCB-style exploration bonus scaled by recency and novelty.
 */
export function curiosityBonus(arm: CuriosityArm, totalUses: number, now: Date = new Date()): number {
  const t = Math.max(1, totalUses);
  const n = arm.uses;

  // UCB exploration bonus
  const exploreBonus = Math.sqrt((2 * Math.log(t + 1)) / (n + 1));

  // Recency: how long since this arm was last tried?
  const lastTime = arm.lastBumpedAt?.getTime() ?? arm.createdAt.getTime();
  const ageMs = now.getTime() - lastTime;
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const recencyFactor = 1 / (1 + ageDays / 30);

  // Novelty: never tried?
  const noveltyFactor = n === 0 ? 1.0 : 0.5;

  return exploreBonus * recencyFactor * noveltyFactor;
}

/**
 * Pick the best arm combining exploitation (UCB) with curiosity.
 * With probability = curiosityRate, returns the most curious unexplored arm.
 * Otherwise, returns the UCB best arm (as in bandit.ts).
 *
 * This mimics human exploration: mostly exploit what works, occasionally
 * try something new out of curiosity.
 */
export function pickCurious(arms: CuriosityArm[], budget: CuriosityBudget = DEFAULT_CURIOSITY): { arm: CuriosityArm | null; reason: "exploit" | "explore" | "random" } {
  if (arms.length === 0) return { arm: null, reason: "random" };

  const totalUses = arms.reduce((s, a) => s + a.uses, 0);
  const now = new Date();

  // Decide: explore or exploit?
  const shouldExplore = Math.random() < budget.curiosityRate;

  if (shouldExplore) {
    // Pick the most curious (highest bonus) arm
    const scored = arms.map((arm) => ({
      arm,
      curiosity: curiosityBonus(arm, totalUses, now),
    }));
    scored.sort((a, b) => b.curiosity - a.curiosity);
    const best = scored[0]!;
    return { arm: best.arm, reason: "explore" };
  }

  // Exploit: UCB best
  const scored = arms.map((arm) => ({
    arm,
    score: ucbScore(arm, totalUses),
  }));
  scored.sort((a, b) => b.score - a.score);
  return { arm: scored[0]!.arm, reason: "exploit" };
}

/**
 * Convert Skills to CuriosityArms for exploration decisions.
 * Queries the same skill records the agent uses.
 */
export function skillsToArms(skills: Skill[]): CuriosityArm[] {
  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    successes: s.successCount,
    failures: s.failureCount,
    uses: s.useCount,
    lastBumpedAt: s.lastAccessedAt,
    createdAt: s.createdAt,
  }));
}

/**
 * Recommend the most curious skill to explore next.
 * Returns the skill with highest curiosity bonus among unvisited / rarely-used ones.
 */
export function mostCuriousSkill(skills: Skill[]): Skill | null {
  if (skills.length === 0) return null;
  const arms = skillsToArms(skills);
  const totalUses = arms.reduce((s, a) => s + a.uses, 0);
  const now = new Date();

  const scored = skills.map((s, i) => ({
    skill: s,
    curiosity: curiosityBonus(arms[i]!, totalUses, now),
  }));
  scored.sort((a, b) => b.curiosity - a.curiosity);
  return scored[0]!.skill;
}
