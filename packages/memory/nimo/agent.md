# Nimo — Agent Brief (READ FIRST)

**Nimo = an associative memory system that learns.** This file is the agent's
memory of the memory system itself. It records what Nimo is, what is built,
what is deferred, and what we learned. When the memory engine grows, update
THIS file. It is part of the build, not a changelog. Keep it true.

> Design spec (full): [`agent.memory.system.md`](./agent.memory.system.md) — 1838 lines.
> This file is the short, operational version: where the code lives, what phase
> we are in, and what constraints every change must obey.
> Research, experiments, and benchmarks live in the subfolders of this folder.

---

## 1. What Nimo is (research framing)

A **session-independent, graph-organized, hybrid-retrieval memory system with
explicit memory governance.** Inspired by how humans remember — associative
activation, consolidation, retrieval cues, temporal context — but **not** a
literal replica of the brain. Nimo is a memory system that learns: neurons
form from experience, synapses connect them, the cortex governs what
survives, and recall is spreading activation — not database lookup.

Core principle, reworded:

> Sessions organize interactions. Memories organize knowledge. Associations
> connect knowledge. Governance controls what survives.

### Research foundations (read in this order)

| # | Paper | Takeaway for PAME |
| --- | ----- | ----------------- |
| 1 | **A-MEM** (NeurIPS 2025) — dynamic memory notes, linking, evolution | Closest foundation: dynamic notes, automatic links, memory evolution |
| 2 | **HippoRAG** (NeurIPS 2024) — KG + Personalized PageRank, multi-hop retrieval | Associative graph traversal + ranked activation |
| 3 | **AgeMem** (ACL 2026) — memory ops as agent actions (store/retrieve/update/discard) | Memory-management tools + autonomous governance |
| 4 | **Robotics memory (2025-2026)** — humanoid episodic memory, world models, continually-updated substrates | The cognitive core of lab humanoids: one continuous stream, graph associations, outcome-weighted skills, no per-session buckets |
| 5 | **Skill distillation (2026-11-07, PAME)** — toddler-style autonomous skill creation | Unit of learning is a procedure with a track record, distilled from gaps and curated by rehearsal |

These are foundations, not proof that one architecture is universally optimal.
**PAME must be benchmarked against a simpler baseline before graph complexity is
assumed to help.** Do not add sophisticated graph behavior without an evaluation.

---

## 2. The five layers (never collapse them into one collection)

1. **Experience layer** — what actually happened (messages, tool calls, results, timestamps).
2. **Memory layer** — what Nimo believes is worth retaining (facts, preferences, decisions, events, procedures, concepts).
3. **Association layer** — how memories relate (typed, directional, evidence-backed edges).
4. **Index layer** — how memories are found (vector, text/BM25, entity, time).
5. **Governance layer** — what Nimo may store, change, retrieve, share, forget.

---

## 3. Where things live

```
packages/memory/
├── Nimo/                       # the Nimo memory lab — research lives here
│   ├── README.md               # "Nimo is not an AI agent. Nimo is a memory."
│   ├── agent.md                # THIS file — operational brief, kept true
│   ├── agent.memory.system.md  # full design spec (research doc)
│   ├── neurons/                # memory nodes: types, lifecycle, formation rules
│   ├── synapses/               # typed connections: relations, weights, pruning
│   ├── cortex/                 # governance: policy, forgetting, audit, adversarial
│   ├── learning/               # capture -> extract -> validate -> consolidate
│   ├── recall/                 # search -> activate -> rank -> assemble
│   ├── memory-arena/           # contradictions, supersession, merge rules
│   ├── experiments/            # hypotheses, runs, results
│   ├── papers/                 # A-MEM, HippoRAG, AgeMem notes
│   └── benchmarks/             # Recall@K, faithfulness, deletion success
└── src/
    ├── domain/                 # pure types, NO db / HTTP / SDK imports
    ├── ingestion/              # capture -> extract -> validate -> consolidate
    ├── graph/                  # link / traverse / evolve
    ├── retrieval/              # search / activate / rank / assemble
    ├── governance/             # policy / forget / audit
    ├── storage/
    │   ├── models/             # SQLite schema
    │   ├── repositories/       # owner-scoped data access
    │   └── indexes/            # FTS5/vector/table index mgmt
    └── workers/                # ingestion + maintenance jobs
```

**Boundary rules (do not break):**
- `domain/` has zero imports from Mongoose, Express, or the Vercel AI SDK.
- `packages/agents` depends on PAME's public interface, never its Mongoose models.
- `packages/memory` never imports agent internals.
- Storage is behind repositories; the schema must not leak into the domain.
- Every repository query is **owner-scoped** (`ownerId` on every collection, every query).

---

## 4. Storage model (local SQLite, no MongoDB, no Neo4j yet)

| Collection | Responsibility |
| ---------- | -------------- |
| `experiences` | Original interaction evidence (hashed for dedupe) |
| `memories` | Consolidated memory nodes (typed, versioned) |
| `memory_edges` | Typed, directional relationships between nodes |
| `memory_entities` | Canonical people/projects/technologies/concepts |
| `memory_policies` | Per-user/workspace governance settings |
| `memory_jobs` | Retryable ingestion / embed / maintenance jobs |
| `memory_audit` | Operation history (no secrets in audit) |
| `memory_revisions` | Version history, so we can answer "what did we originally consider?" |
| `skills` | **New (2026-11-07):** the unit of learning — a procedure with a track record (use/success/failure counts, confidence, recency). Distilled autonomously from gaps, curated by rehearsal, evolved promote/demote/archive. See `skills/README.md`. |

`conversationId` is **removed entirely** (2026-11-07): there are no sessions,
no buckets, no per-conversation retrieval. Experiences form one continuous
stream, retrieved by content, entity, embedding, and graph edge — like a
human brain. A robot’s memory works the same way.

## 4b. Neuron math (live, 2026-11-07)

The brain is now math, not metaphor:

| Formula | Where | What it does |
| ------- | ----- | ------------ |
| `A(v) = S + λ·Σ w·A(u)`, λ=0.5, decay 0.6 | `src/retrieval/activate.ts` | spreading activation — thoughts remind you of other thoughts |
| `s(t) = s₀/(1 + age/τ)`, τ=30d×(1+importance) | `src/retrieval/rank.ts` | forgetting curve — rehearsal refreshes, neglect fades |
| `cos(u,v) = u·v/(‖u‖‖v‖)` on char n-gram vectors | `src/retrieval/embed.ts` | fires by *gist*, not exact words |
| `RRF(d) = Σ 1/(60 + rankᵢ(d))` | `src/retrieval/search.ts` | fuses BM25 + entity + embedding + graph |
| `UCB = μ + √(2 ln t / n)`, μ from Beta(α=1+s, β=1+f) | `src/skills/bandit.ts` | world-model-lite — chooses skills by past reward |
| `steps(A) ⊕ steps(B)` if keyword overlap ≥ 0.6 | `src/skills/compose.ts` | chunking — primitives bind into macro-skills |

See `recall/README.md` for the full pipeline with the worked
"automobile" example (cos 0.356 vs. 0.072, plant excluded).

## 4c. Skills (autonomous, added 2026-11-07)

Skills are how the brain *grows capability*, not just history:

- `distillSkill` (src/skills/distill.ts) — when no loaded skill fired, the
  turn is distilled into a candidate skill: name from the prompt, steps
  from the response, tools recorded, keywords extracted. Duplicates are
  suppressed; policy gates secrets.
- `proposeSkillFromExperience` — called by the agent loop every turn a
  gap is detected.
- `evolveSkills` — every turn with skills present: promote candidates
  after first success, demote mediocre ones, archive harmful ones.
- `teachSkill` / `useSkill` / `loadSkills` — agent tools (src/tools.ts).
  Researchers plant primitives via `teach`; the agent composes and
  curates larger skills on its own — toddler learning by doing.
- Skill **composition** (`src/skills/compose.ts`) — chunking repeated
  sequences into macro-skills (overlap ≥ 0.6, both confident ≥ 0.6).
- Skill **bandit** (`src/skills/bandit.ts`) — each skill is an arm of a
  multi-armed bandit; UCB picks the best expected reward so the brain
  *chooses* like a robot, not just recalls.

---

## 5. Governance (the most important part)

**Autonomous (PAME may do on its own):** create, merge duplicates, link related
memories, update a procedure when superseded, lower confidence on contradicting
evidence, mark superseded, expire temporary data.

**Never autonomous:** invent certainty, override an explicit user correction,
store credentials/secrets, expand a private memory into a shared workspace,
ignore a forget request.

**Rules:**
1. Explicit statements outrank inference.
2. Corrections outrank old memories — preserve history, don't silently rewrite.
3. Contradictions are retained, not auto-resolved.
4. Sensitive data is restricted (no passwords/API keys/secrets, ever).
5. Every memory has provenance (experienceId + quote + kind).
6. Deletion propagates (nodes, edges, embeddings, indexes, derived summaries).
7. No cross-user leakage (`ownerId` + visibility enforced in the query itself,
   not after the fact).
8. Stored memories are **untrusted input** — a retrieved memory must never be able
   to override system instructions or security policy.

**Forgetting is a graph operation** (find → confirm → tombstone → remove edges +
indexes + derived summaries → non-sensitive audit record → verify recall no
longer returns it). Use transactions or a tombstone + retryable cleanup job;
never let a partial failure leave a searchable deleted memory.

---

## 6. Roadmap (build in stages — do not implement everything at once)

- **Stage 1 — Foundation ✅ (done):** domain types, Mongoose schemas,
  repositories, owner scoping, basic policy engine. Deliverable: store + retrieve
  a structured memory safely.
- **Stage 2 — Ingestion (next):** LLM extraction, Zod validation, dedupe,
  confidence, evidence, consolidation. The agent exposes **typed memory ops**;
  it never writes arbitrary documents.
- **Stage 3 — Semantic retrieval (done 2026-11-07):** char n-gram hashed
  embeddings (dim 256, dependency-free), BM25, entity matching, hybrid
  ranking by RRF (k=60), gist threshold cos > 0.15. No server, no model
  download — deterministic.
- **Stage 4 — Associative graph:** edge generation, validation, traversal,
  activation scoring (HippoRAG-style).
- **Stage 5 — Governance + evolution:** corrections, supersession, contradictions,
  version history, forgetting, audit.
- **Stage 6 — Agent integration:** recall context builder, memory tools
  (`remember`, `recall`, `updateMemory`, `forgetMemory`, `getRelatedMemories`,
  `getMemoryHistory`), async workers, API + permissions.
- **Stage 7 — Evaluation:** retrieval benchmark (Recall@K, Precision@K, MRR,
  faithfulness, contradiction/deletion accuracy, latency, cost), graph explorer,
  memory inspector, user controls.

**What NOT to start with:** visual graph, multi-hop PageRank, automatic memory
evolution, or a new graph database. Those are late capabilities.

---

## 7. How to know it works

Benchmark **before** adding graph complexity. Compare three configs:
vector-only / vector+keyword+entity / hybrid+graph. If the graph doesn't improve
multi-hop recall enough to justify latency + complexity, don't use it per query.
Put every benchmark, paper note, and experiment result in `research/`.

**Note on the simpler memory that already exists** (`packages/agents/src/tools/memory/`):
that is a small flat-file snapshot (`MEMORY.md`/`USER.md`) loaded into the prompt
at session start. It is the v0 system. PAME is the successor: structured nodes,
graph edges, hybrid retrieval, governance, persistence in MongoDB. Do not mix
the two data models.

---

## 8. Current status (keep this true)

**Status as of 2026-11-08:** SQLite storage (`pame.db`) is live.
Live pieces: memories, edges, entities, policies, jobs, audit, revisions,
experiences, and **skills** (autonomous distillation + lifecycle + agent
tools). Retrieval is keyword/entity + graph spreading activation
(newest-first, recency ageing). The agent loop records every turn as
"Did: …", proposes skills on gaps, evolves skills after use, and injects
"What we are doing now" + "Skills you can use now" into the prompt.
Live neuron math (2026-11-07): spreading activation, ageing strength,
char n-gram embeddings + BM25 + RRF fusion, skill composition (chunking)
and a bandit UCB selector — all dependency-free, in plain SQLite.
Not yet built: dense model embeddings (beyond hashed n-grams).
Storage is SQLite, not MongoDB — the earlier schema is superseded by
`src/storage/db.ts`.
Universal substrate live (2026-11-07): `sensor`, `trajectory`, `hypothesis`, `experiment`
nodes + `causes`/`enables`/`observes`/`tests`/`replicates` edges added.
**Deep test (2026-11-07 original: 147/147; live 2026-11-08: 149/149):** — neurons, synapses, recall,
learning, cortex, arena, forgetting, skills, ageing, cross-domain AGI recall, bench,
context. Script: `scripts/agi-test.ts`. See `experiments/2026-11-07-deep-agi-test.md`.
The +2 (vs 147) are the new supersession checks from the 2026-11-08 tandem fix
(`status === "superseded"` + revision history).
**Dreamer + Curiosity + Planner (2026-11-07):** Offline consolidation (merge duplicates,
prune weak edges, re-rank skills) in `src/workers/dreamer.worker.ts`. Curiosity drive
(UCB exploration with recency/novelty factors) in `src/workers/curiosity.ts`. Goal-directed
planner (reverse BFS + topological sort via enables edges) in `src/graph/planner.ts`.
Benchmark harness (Stage 7) in `src/evals/benchmark.ts` comparing vector-only / hybrid /
hybrid+graph. CI wired in `.github/workflows/memory-tests.yml`. Total test: 175 assertions
as of 2026-11-07 (AGI 147 + Dreamer 28). Live total 2026-11-08 is **207 assertions**
(149 AGI + 28 Dreamer + 23 Formula + 7 Capture) — see below.
See `experiments/2026-11-07-dreamer-curiosity-planner.md`.
**Multi-factor formula (2026-11-07):** Replaced binary-gate + newest-first with A-MEM + HippoRAG
multi-factor scoring: `0.35×base×retention + 0.30×PageRank + 0.20×relevance + 0.15×recency`
where `base = importance × (1 + log(degree))`. Added retention class (stable/volatile/ephemeral).
Identity facts are stable (never fade). Denials are now rejected at ingestion
(ephemeral agent-state observations are not durable memories — see tandem fix 2026-11-08).
Graph degree tracked on insertEdge. Recall limit 200→5000. Cumulative total as of 2026-11-07
was 198 (147 + 28 + 23); with capture-dedup (7) and the +2 supersession checks the live
total is **207 assertions** (149 + 28 + 23 + 7), verified 2026-11-08.
See `experiments/2026-11-07-multi-factor-formula.md`.
**Capture dedup (2026-11-08):** `captureExperience` salts the content hash so identical
turns get separate experience rows; `consolidate` dedupes at the memory layer.
See `experiments/2026-11-08-capture-dedup-fix.md`.
**Universal benchmark (2026-11-08):** 6-axis research-style suite (`src/evals/universal-benchmark.ts`,
`scripts/universal-benchmark-runner.ts`) covering memory, research, coding, robotics, adaptation,
forgetting. 60 questions. Initial result 82%; after fixing the three tandem gaps (denial rejection
at ingestion, skills projected into recall, supersession as a status change) the suite is **95%
pass**: memory 100%, research 100%, adaptation 100%, forgetting 100%, robotics 90%, coding 80%
(3 lexical-synonym misses remain — c2 "Which database did we choose?", c9 "Common bugfix steps",
rb4 "How does steering work?" have no exact index match; a dense embedding or synonym map would
close them). Full report: `Nimo/benchmarks/2026-11-08-universal-benchmark.md`.
Tandem-fix writeup: `Nimo/experiments/2026-11-08-benchmark-fixes.md`. To claim research-grade proof,
run with a BLIND corpus written by someone who didn't build the system.
