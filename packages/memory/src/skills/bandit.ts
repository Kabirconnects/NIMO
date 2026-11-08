// skills/bandit.ts
// World-model-lite: each skill arm gets a Beta(α,β) posterior from its
// outcomes; UCB picks the arm with the best expected reward so the brain
// *chooses* like a robot, not just recalls.
//   posterior: α = 1 + successes, β = 1 + failures
//   UCB: mean + sqrt(2 ln t / n)

export interface BanditArm {
  id: string;
  name: string;
  successes: number;
  failures: number;
  uses: number;
}

export function ucbScore(arm: BanditArm, totalUses: number): number {
  const alpha = 1 + arm.successes;
  const beta = 1 + arm.failures;
  const mean = alpha / (alpha + beta);
  const t = Math.max(1, totalUses);
  const n = Math.max(1, arm.uses);
  return mean + Math.sqrt((2 * Math.log(t)) / n);
}

export function pickBest(arms: BanditArm[]): BanditArm | null {
  if (!arms.length) return null;
  const total = arms.reduce((s, a) => s + a.uses, 0);
  return [...arms].sort((a, b) => ucbScore(b, total) - ucbScore(a, total))[0] ?? null;
}
