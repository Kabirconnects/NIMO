# Skills

Skills are the **unit of learning** — a procedure that has *worked* before.
A memory remembers what happened; a skill remembers **how to do it again**,
and its weight is its track record.

## Why skills exist

Facts alone don’t compound. A fact says "we use Bun". A skill says
"when tests fail: read the error → find the failing file → patch →
rerun". The second is reusable capability. Skills are how the brain,
not just the store, grows.

## Skill anatomy

Every skill has:

- `name` — short, e.g. `fix-test`.
- `whenToUse` — one line the retriever matches against.
- `steps` — exact steps, in order.
- `toolsUsed` — tools proven to be involved.
- `examples` — worked examples (quotes / stories).
- `useCount`, `successCount`, `failureCount` — the track record.
- `confidence` — successes ÷ uses.
- `status` — `candidate` → `active` → `archived` / `deleted`.

## Lifecycle (autonomous)

1. **Gap detected** — no skill fired for a prompt, or a skill failed.
2. **Distill** — `distillSkill` turns the experience into a candidate:
   name from the prompt, steps parsed from the response, tools recorded.
3. **Rehearse** — every use calls `useSkill`. Success strengthens
   confidence and refreshes recency; failure fades it.
4. **Evolve** — `evolveSkills` runs each turn:
   - candidate + first success → `active`
   - repeated failures → `archived`
   - mediocre track record → demoted to `candidate`

This is toddler learning: do → distill → rehearse → the neuron for
that procedure gets stronger. The researcher’s `teach` plants
*primitives*; the agent composes them and proposes larger skills.

## Ranked like human memory

`loadSkills` scores by keyword/entity fit × success-rate × recency
ageing. Newest and most-proven skills surface first. Unused skills
fade; rehearsed ones persist.

## Composition — brain chunking (added 2026-11-07)

Two active skills compose into a macro-skill when they share keywords
and both are confident:

```
chunkedSteps(A,B) = steps(A) ⊕ steps(B)
   if |keywords(A) ∩ keywords(B)| / |keywords(A) ∪ keywords(B)| ≥ 0.6
   and confidence(A) ≥ 0.6 and confidence(B) ≥ 0.6
```

Implemented in `src/skills/compose.ts` (`findComposeCandidates`).
This is chunking — the brain compresses a repeated sequence into one
bigger neuron. Primitives taught by a researcher bind into larger
procedures the agent can then fire as a single chunk.

## World-model-lite — bandit choice (added 2026-11-07)

Each skill is an *arm* of a multi-armed bandit. Outcomes update a Beta
posterior; UCB picks the arm the robot should try next:

```
α = 1 + successes,  β = 1 + failures
μ = α / (α + β)
UCB = μ + √(2 ln t / n)          t = total uses, n = uses of this arm
```

Implemented in `src/skills/bandit.ts` (`pickBest`). This is the piece
that makes memory *choose* like a humanoid robot, not just recall:
the brain values a skill by past reward and explores optimistically.

## What goes here

- Distillation rules and worked examples: show a raw experience and
  the skill it became, step by step.
- Skill-composition: how three small skills bind into one.
- Benchmarks: does skill-retrieval beat memory-retrieval on
  multi-step tasks (Recall@K over skills, not just facts)?
