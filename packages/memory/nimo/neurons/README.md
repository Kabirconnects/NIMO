# Neurons

One neuron = one memory node. Neurons behave like real ones: they are
retrieved by *semantic similarity* (embedding cosine on char n-gram
vectors), *fired* by spreading activation along synapses, and *decayed* by
the forgetting curve `s(t) = s₀/(1 + age/τ)`. Recall itself is read-only:
retrieving a memory does **not** refresh `lastAccessedAt` or raise
confidence, so reading cannot silently strengthen a belief. Explicit
writes (correction, consolidation, an intentional touch) are what count
as rehearsal. Recall fuses four independent rankings — BM25, entity,
embedding, graph — by RRF:
`RRF(d) = Σ 1/(60 + rankᵢ(d))`.

A neuron holds:

- **Content** — the fact, preference, decision, event, concept, procedure,
  goal, or observation.
- **Confidence** — how strongly the evidence supports it (0–1).
- **Importance** — how valuable it is to keep (0–1), independent of
  confidence.
- **Evidence** — the original experience (message, tool result, observation)
  that created it, with a quote and timestamp.
- **Lifetime** — `valid_from` / `valid_until`. Some neurons expire. Some
  live forever.

## Neuron types

| Type | Example | Retention |
| ---- | ------- | --------- |
| `fact` | "Nimo uses SQLite" | Until superseded |
| `preference` | "Prefers concise answers" | Until changed |
| `decision` | "Chose SQLite over MongoDB" | Until revised |
| `event` | "Fixed a registry error on Nov 5" | Historical |
| `concept` | "Associative memory architecture" | Long-term if useful |
| `procedure` | "How to start the Nimo API" | Until outdated |
| `goal` | "Build a complete agent harness" | Until completed or changed |
| `observation` | "API returned an undefined model" | Evidence, not necessarily fact |

## What goes here

- Neuron formation rules — how an experience becomes a neuron.
- Type system evolution — when a new type is needed.
- Neuron lifecycle — birth, strengthening, supersession, death.
