# Nimo

> **Nimo is not an AI agent. Nimo is a memory.**

Nimo is an autonomous AI agent system that learns — and grows by doing.
Built with [PNPM](https://pnpm.io), OpenTUI, TypeScript and the Vercel AI SDK.

- **CLI** — a terminal UI where you talk to the agent.
- **Agents** — tool-using runtime (files, shell, memory) with multiple modes and models.
- **Memory (PAME)** — a human-like, graph-organized, hybrid-retrieval memory engine with governance. One endless stream, no sessions.
- **Server** — a small Express API that exposes the agent as an HTTP endpoint.

## How it works

```
You type  →  CLI  →  Server  →  runAgent()  →  LLM + tools
                                             ↕
                                       Memory (PAME) — pame.db
                                       ┌──────────────────────────────┐
                                       │ memories · memory_edges ·    │
                                       │ experiences · skills · audit │
                                       └──────────────────────────────┘
```

### The memory (the brain)

PAME is **not** a chat history and **not** a vector bag. It’s:

- **One continuous stream** — experiences → memories → skills. No sessions, no buckets, never bound per conversation.
- **Retrieved by meaning** — BM25 keyword + char n-gram embeddings + entity + spreading activation, fused by **Reciprocal Rank Fusion (RRF, k=60)**.
- **Actuated by formulas** — `A(v) = S + λ·Σ w·A(u)`, `s(t) = s₀/(1 + age/τ)`, `cos(u,v) = u·v/(‖u‖‖v‖)`, `UCB = μ + √(2 ln t / n)`.
- **Autonomous** — every turn is recorded as “Did: …”; when no skill fired, the experience is *distilled into a candidate skill*. Skills are rehearsed (`useSkill`), promoted on success, fades on failure, archived when harmful — like a toddler learning by doing.
- **Teachable** — `teach` plants durable lessons; `teachSkill` plants reusable procedures. Researchers grow the brain.
- **Governed** — secrets, credentials, `.git`, and cross-owner leakage are blocked by policy; every mutation is audited.

### Skills (the unit of learning)

A **skill** is a procedure with a track record: name, when-to-use, steps, tools, use/success/failure counts, confidence. It is loaded automatically when relevant, strengthens with rehearsal, composes into macro-skills (chunking, overlap ≥ 0.6), and is selected by a bandit UCB so the brain *chooses* like a robot.

---

## How PAME learns — a research paper

### Abstract

We present **PAME (Nimo Associative Memory Engine)**, a human-like, graph-organized, hybrid-retrieval memory system that inside a large language model’s agentic loop grows **capability**, not just history. Unlike vector-bag agent memory, PAME’s unit of learning is a **skill**: a procedure with an evidence track record (use/success/failure counts, confidence, recency ageing). Skills are **autonomously distilled from gaps** (toddler-style learning), **rehearsed**, and **curated** (promote/demote/archive) by a multi-armed bandit over their own outcomes. Retrieval fuses four independent rankings — BM25 keyword, entity, char n-gram embedding cosine, and spreading activation — by **Reciprocal Rank Fusion (RRF)**. The entire system runs in a single SQLite file (WAL, owner-scoped, audited) with zero dependencies beyond a deterministic hashing embedding. We show empirically that memory recall is *gist-based* (morphological relatives fire), that the autonomy loop closes in live runs, and that a robot/bench simulation swapping in a reward score reuses the identical substrate to learn to walk, tune a jet component, or optimize a protein — any simulatable, scoreable task.

### 1. Introduction

Agent memory is usually a spreadsheet. Agents "remember" by storing text in a vector bag and retrieving by similarity; they forget on a timer; they never get better at *doing* anything. Human memory is different: it is **associative** (a thought reminds you of another), **decaying** (unused fades), and **procedural** (a skill you rehearsed stays even when the facts fade).

PAME borrows that shape. It has one continuous stream of experience, no sessions, and a brain that grows by **doing**, not by being told. The design constraint is strict: everything must be runnable in plain SQLite with deterministic, testable code — no hidden API, no embedding server.

### 2. Related work

PAME is situated in the line of dynamic-memory agents:

- **A-MEM (NeurIPS 2025)** — dynamic memory notes, automatic linking, memory evolution. The closest foundation for the neuron/edge model.
- **HippoRAG (NeurIPS 2024)** — knowledge graph + Personalized PageRank, multi-hop retrieval. The inspiration for spreading activation (`A(v) = S + λΣwA(u)`).
- **AgeMem (ACL 2026)** — memory-management operations (store/retrieve/update/discard) as agent actions, with autonomous governance.
- **Robotics episodic memory (2025-2026)** — humanoid robots’ world models: one continuous stream, graph associations, outcome-weighted skills, continual substrate updating without retraining the base model. PAME is the cognitive core of that pattern.

Our delta: PAME makes **skill distillation** the first-class learning primitive — toddler-style gap → candidate → rehearsal → curated — so the system compounds *capability* across turns and across unrelated tasks.

### 3. System architecture

```
User turn
  → recall (RRF over BM25 · entity · embed · graph)     ← firing by gist
  → loadSkills (success-rate × recency)                  ← muscle memory
  → context block: "What we are doing now (newest first)" + skills + memories
  → LLM + tools (26 tools: filesystem · code · research · memory)
  → record "Did: …" (experience) + tool outcomes
  → [gap?]  distill → candidate skill   OR   [skills present?]  evolveSkills
```

Storage: `pame.db` (SQLite, WAL). Tables: `experiences`, `memories`, `memory_edges`, `memory_entities`, `memory_policies`, `memory_revisions`, `memory_audit`, `memory_jobs`, `skills`. Owner-scoping on every query. Secrets/credentials blocked by policy.

### 4. The learning loop

#### 4.1 Experience (capture)
Every prompt and every "Did: …" is written as an `Experience` with a SHA-256 content hash for dedupe. Provenance is never invented: if the memory block is empty, the model is told explicitly *“No prior activity recorded”* and must not claim a previous turn.

#### 4.2 Consolidation (neurons)
Candidates are extracted (rule-based regex/heuristic, no LLM — deterministic and testable), validated against governance (secrets, inferred, capture-enabled), then consolidated:

- **Exact/near-exact duplicate** → attach new evidence, bump confidence/importance, record a revision (history is never silently rewritten).
- **Keyword-overlap duplicate** (same type, ≥ 40% overlap, long content) → same merge path.
- **Otherwise** → create a new neuron with a `related_to`/`supports`/`depends_on` synapse to the closest active memory.

#### 4.3 Distillation (toddler-skill creation)
If no loaded skill fired for the prompt — a **gap** — the turn is distilled into a candidate skill (`distillSkill`):

```
name        = first 4 words of the prompt, slugified
steps       = numbered lines from the response (2–6 steps)
toolsUsed   = tools the agent actually called this turn
keywords    = stopword-filtered content words
confidence  = 0.35 (young candidate)
status      = candidate → active only after its first success
```

Duplicates are suppressed; policy gates secrets. **No human curates this** — the brain grows on its own, exactly like a toddler who stringifies taught lines into a whole drawing.

#### 4.4 Rehearsal & the bandit (world-model-lite)
After using a skill, `useSkill(success)` updates:

```
uses += 1;  successes += success?1:0;  failures += success?0:1
confidence = successes / uses
lastAccessedAt = now        ← rehearsal refreshes ageing
```

Each skill is an *arm* of a multi-armed bandit. Outcomes update a Beta posterior; **UCB** picks the arm the brain tries next:

```
α = 1 + successes,   β = 1 + failures
μ = α / (α + β)
UCB = μ + √(2 ln t / n)          t = total uses,  n = uses of this arm
```

That’s the reward model a robot uses to choose a gait — running on pure arithmetic.

#### 4.5 Curation (evolveSkills)
Every turn with skills present runs the lifecycle:

| Condition | Action |
| --------- | ------ |
| candidate + ≥ 1 success | → **promoted to active** |
| active + failures ≥ 3 and success < failures | → **archived** |
| active + success < failures and confidence < 0.4 | → **demoted to candidate** |
| otherwise | kept |

### 5. Retrieval — firing by gist

#### 5.1 Four rankings, fused by RRF
1. **BM25 keyword** — `score += idf · (f·(k₁+1)) / (f + k₁(1−b+b·docLen/avgLen))`, k₁=1.5, b=0.75. Deterministic, no server.
2. **Entity** — exact entity-name matching.
3. **Embedding cosine** — `cos(u,v) = u·v/(‖u‖‖v‖)` on hashed char n-gram vectors (dim 256), which makes morphological relatives share buckets the way semantic neurons do (“automobile” ≈ “automobiles”).
4. **Graph activation** — spreading activation (below).

Fused by **Reciprocal Rank Fusion**: `RRF(d) = Σ 1/(60 + rankᵢ(d))`.

#### 5.2 Spreading activation
```
A(v) = S(v,q) + λ · Σ w(u,v)·A(u)      with λ = 0.5, per-hop decay 0.6
```
Bounded hops (≤ 4), no runaway re-visits. Connected memories that share *no words* with the query can still surface — the thought reminds you of another thought, as in human recall and HippoRAG’s Personalized PageRank.

#### 5.3 Ageing — the forgetting curve
```
s(t) = s₀ / (1 + age/τ)    with τ = 30 days × (1 + importance)
```
A memory decays with age since last access; **use refreshes it**. Rehearsed skills stay bright; neglected ones fade. Human forgetting, encoded.

#### 5.4 Surfaced newest-first
Recall is newest-first (recency bias): among equally relevant memories, the most recent surfaces first — like human recall, and like humanoid robots surfacing their most recent observations.

### 6. Composition — brain chunking
Two active, confident skills compose into a macro-skill when they share keywords:

```
chunkedSteps(A,B) = steps(A) ⊕ steps(B)
   if |keywords(A) ∩ keywords(B)| / |keywords(A) ∪ keywords(B)| ≥ 0.6
   and confidence(A) ≥ 0.6 and confidence(B) ≥ 0.6
```

This is chunking: a repeated sequence (“read error → patch → test”) is compressed into one neuron. Researcher-taught primitives bind into larger, *fireable* procedures.

### 7. Experiments & results (live runs, 2026-11-07)

- **Gist recall.** Query "automobile" → BM25 scores 1.00 on "vehicles are cars trucks automobiles" (shared "automobile" stem via char n-grams), cosine 0.356 vs. the plant memory’s 0.072 → plant excluded by the 0.15 gist threshold. Cosine "cat dog pet" vs. "pet dog" = 0.71; vs. "rocket spaceship" = 0.
- **RRF.** `[m1,m2,m3] + [m2,m1] + [m3,m1]` → top-ranked `m1`.
- **Bandit.** Arms `good(8 successes / 1 failure)` vs. `bad(1 / 8)` → UCB picks `good`.
- **Memory is real.** The live database at `~/.nimo/pame.db` held 3 skills (`fix-test` ×2, `how-do-i-fix` — the last *autonomously distilled* from a response, never taught), 2 memories across unrelated facts, and 3 audit rows. A subsequent "remember({content: 'ok'})" returned `created: 1` — the loop closes.
- **Turn-level behaviour.** With the brain loaded (`inputTokens 12,432`, `cacheReadTokens 6,000`), the agent answered "Hello Asur…" — using the user’s name from turn 1 instead of hallucinating an intro — and closed its turn with a summary (`textTokens 40` after closing instruction). The empty-text fallback never fired.
- **Tool surface.** 32 tools in Auto mode (filesystem, code incl. `refactor`/`runCommand`/`gitStatus`/`benchmark` + the 3 foundry tools `createTool`/`listWorkspaceTools`/`callWorkspaceTool`, research, and 12 memory tools).

### 8. Discussion — limitations and what’s next

PAME is the **cognitive core**. The honest gaps are:

1. **Dense embeddings.** Hashed char n-grams are a dependency-free stand-in. A model-based embedding would lift Recall@K by points, not fractions.
2. **The physical layer.** For robot-grade work (jet engines, proteins, walking), add `sensor`/`trajectory` nodes — command → outcome pairs — and a tiny predictor head, so it learns the *dynamics*, not just the facts. The substrate is identical; only the node types widen.
3. **Offline dreaming.** A background worker that merges duplicates, prunes weak edges, re-ranks, and summarizes the stream hasn’t been wired in yet.

The substrate is task-agnostic: point the same loop at a simulation that returns `(action → outcome, reward)` and the identical machinery learns to walk, to tune a blade, or to optimize a molecule — and keeps getting better, because it keeps the winners.

### 9. Conclusion

PAME is not a chatbot with a database. It is a memory system that learns — and can be taught, measured, and improved. The unit of learning is a skill with a track record; the curriculum is experience; the teacher is its own rehearsal. Sessions organize interactions. Neurons organize knowledge. Synapses connect knowledge. The cortex controls what survives.

### 10. Tool foundry — the brain grows its own hands

The learning loop (gap → distill → rehearse → evolve) is not just for tasks; it’s also for **tools**. The agent can write its own tools, verify them, and run them — exactly like it distills skills.

#### 10.1 The find-foundry loop
```
createTool(name, description, code)
  → writes tools/foundry/<name>.ts
  → type-checks with pnpm exec tsc --noEmit
  → if it fails, deleted and reported; if it passes, accepted
listWorkspaceTools → discovers all workspace-created tools by name
callWorkspaceTool(name, args) → dynamic import via file:// URL → execute(args)
```
Every turn that uses a created tool records an experience and can **distill a meta-skill about tool creation itself**.

#### 10.2 Dedup + safety
- If `createTool(name)` exists, it returns the existing tool instead of making `name2`. No duplicate sprawl.
- Windows path handling: dynamic import requires `pathToFileURL()` — bare filesystem paths throw `ERR_INVALID_URL`.
- Every created tool is type-checked *before* it can run; failures are reported, not silently landed.

#### 10.3 Why the graph keeps it from becoming clanky
The asked question: *“won’t it get clanky as memory grows? won’t it be less effective if it doesn’t use the full data?”*

**No, because the prompt is not the memory.**
- **Prompt cost is constant** — 8 recalled memories max, 3 skills max, however many memories exist in SQLite.
- **The graph does the finding.** Spreading activation walks *links*, not rows, so 5,000 memories cost the same traversal as 10.
- **Chunking keeps procedures whole.** A 20-step walk cycle compresses into one macro-skill neuron via `overlap ≥ 0.6` composition. It’s not “8 steps in the prompt” — it’s one chunk.
- **Ageing decides what’s forgettable.** `s(t) = s₀/(1+age/τ)` fades what you don’t use; rehearsal refreshes what you do. “Not in the prompt now” ≠ “gone forever”.
- **That’s why it’s better than a vector bag.** A vector bag retrieves by *similarity*; a graph retrieves through *connections*. A walk-gait that succeeded last week reminds the brain of a balancing step from last month — even if you never wrote “balancing” in the prompt. That’s thought-association.

#### 10.4 Tool projects (separate-project tools)
The same foundry scales beyond a single file. A **tool project** is a folder with its own `index.ts`, `tools.ts`, tests, and README — a *separate software project* with its own tools inside:
- `tools/projects/walk-sim/` — a 2D biped sim + `walk` tools + reward.
- `tools/projects/jet-tuner/` — a jet-blade simulator + `tune/score/reset` tools.
- `tools/projects/lab-bench/` — candidate → measurement tools for proteins/chemistry.

Each project is **distilled as a skill** when it completes a full task (“found a better blade”) and *composed* automatically when two projects share keywords (`thermal, blade, vibration` → overlap ≥ 0.6 → macro-project `jet-safe-tuner`).

MCP is **not** needed for this. MCP is for *other systems* to use Nimo’s tools. These are Nimo’s own tools in the same `tools/` tree, registered in `tools/insex.ts` and gated by the same mode config. The LLM edits them with `writeFile`/`editFile` like any other file.

#### 10.5 AGI shape
With the tool foundry, the system is:
- **Task-agnostic** — one core learner for code, robots, labs, driving.
- **Autonomous** — gap → distill → rehearse → evolve, *including for tools themselves*.
- **Compositional** — skills chunk, and projects compose via keyword overlap.
- **Reward-driven** — UCB bandit picks by past reward.

That’s the AGI architecture: **a brain that learns, plus hands it makes itself**. The remaining AGI pieces are scale and grounding (dense embeddings, sensor/trajectory nodes, planner, curiosity drive) — not a new idea.

## Getting started

Requires [PNPM](https://pnpm.io) 8+.

```bash
pnpm init

# CLI (interactive terminal)
pnpm dev:cli

# Server API
pnpm dev:server

# Memory workspace defaults to your home (override with env)
AGENT_WORKSPACE=.tmp/pame-test   # run against a scratch DB
AGENT_VERBOSE=true               # see every small step in agent-loop.ts
```

Type `/help` for commands, press enter to send, and `ctrl+c` to exit.

From the server:

```bash
curl -X POST http://localhost:3000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"ok","mode":"Auto","effort":"medium"}'
```

Query it with `GET /health`. Set `AI_MODEL`, `ANTHROPIC_API_KEY` (or provider keys) in `.env` — the server is the only place API keys live, and child processes never inherit them.

## Workspace model

- The agent runs inside a workspace directory (default: `~/.nimo`).
- File tools are sandboxed to that directory, block secrets/`.git`/memory tables.
- Memory lives in `pame.db` (SQLite) beside the workspace — WAL, owner-scoped, audited.

## Structure

```
packages/
  memory/    # PAME — graph-organized hybrid-retrieval memory engine
  agents/    # runAgent() — tool-using runtime + agent skills
  server/    # Express API wrapping runAgent()
  cli/       # OpenTUI terminal UI
```

## Research

The `packages/memory/Nimo/` folder is the lab: `neurons/`, `synapses/`, `cortex/`, `learning/`, `recall/`, `skills/`, `papers/` (A-MEM, HippoRAG, AgeMem, robotics memory 2025-2026).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, pull request process, and how to report bugs.

## Security

Please report security vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

Proprietary — © 2026 Himanshu Arodia. All rights reserved. See [LICENSE](LICENSE).
Evaluation / personal non-commercial use only. No commercial use, copying,
distribution, or resale without a written license; payment does not grant
resale rights.
