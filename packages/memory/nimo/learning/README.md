# Learning

How Nimo learns. Not by retraining — by forming neurons from experience,
connecting them with synapses, and evolving what it believes when the world
changes.

## Autonomy (added 2026-11-07)

Learning is now fully autonomous — a toddler who grows his own skills:

- **Gap → distill.** When no loaded skill fired for a prompt, the turn is
  distilled into a *candidate skill* (`distillSkill`). No human plants
  every lesson.
- **Rehearsal loop.** Every turn records "Did: …", and after using a
  skill the agent calls `useSkill` — success boosts confidence +
  recency, failure fades it.
- **Lifecycle evolve.** `evolveSkills` promotes candidates with a
  success, demotes mediocre track records, and archives harmful ones —
  automatically, every turn.

The `teach` tool remains the researcher’s curriculum (plant a
primitive), but the agent now proposes and curates skills on its own.

## The learning cycle

1. **Capture** — preserve the experience as-is. Do not immediately turn
   every sentence into a permanent memory.
2. **Extract** — identify candidates: facts, decisions, preferences,
   entities, relationships, goals.
3. **Validate** — explicit? inferred? uncertain? sensitive? contradictory?
4. **Consolidate** — merge duplicates, update what is justified, create
   what is new, supersede what is corrected.
5. **Associate** — find related neurons, create typed synapses with
   evidence.
6. **Index** — make it findable via text, entity, and vector search.

## Consolidation rules

| Situation | Action |
| --------- | ------ |
| Same fact repeated | Attach new evidence to existing neuron |
| Same concept, different wording | Merge if semantically equivalent |
| New information adds detail | Update or create a related neuron |
| Explicit correction | Supersede the old claim (preserve history) |
| Conflicting claims | Keep both, flag conflict |
| Temporary task completed | Archive or expire |
| New experience changes context | Re-evaluate related neurons |

## What goes here

- Capture/extract/validate/consolidate pipeline design.
- Duplicate detection strategy.
- Confidence calibration — when is Nimo sure enough?
- Forgetting curves — how does decay work? Should it?
- Worked examples: walk through a conversation and show exactly which
  neurons form, which synapses are created, and why.
