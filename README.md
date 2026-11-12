<div align="center">

# Nimo

**A persistent, associative, governed memory engine for tool-using agents.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178c6)](https://www.typescriptlang.org) [![Node.js](https://img.shields.io/badge/Node.js-20.9+-339933)](https://nodejs.org) [![pnpm](https://img.shields.io/badge/pnpm-11.25-F46F2E)](https://pnpm.io) [![Turborepo](https://img.shields.io/badge/Turborepo-2.11-ED1C24)](https://turborepo.com) [![AI SDK](https://img.shields.io/badge/AI%20SDK-7.0-000000)](https://ai-sdk.dev) [![SQLite](https://img.shields.io/badge/SQLite-WAL-003B00)](https://www.sqlite.org) [![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org) [![Bun](https://img.shields.io/badge/Bun-1.3+-FBAC00)](https://bun.sh) [![License](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)

</div>

> **Nimo is not an AI agent. Nimo is a memory.**
>
> This repository contains both the memory engine and an agent harness that exercises it. The research claim is about the memory: an agent should not start every turn as a stranger, and it should not merely accumulate chat history. It should retain evidence, connect related knowledge, preserve contradictions, forget safely, and turn repeated procedures into reusable skills.

---

## Abstract

Large-language-model agents are usually given memory as an afterthought: a transcript is appended to a context window, or text is embedded into a vector store and retrieved by cosine similarity. Both approaches lose structure. They cannot distinguish a fact from a question, a correction from a repetition, or a supported belief from a guess. They cannot explain why a memory exists. They cannot delete one without leaving copies in indexes, edges, summaries, and audit trails. They rarely learn *how* to do something — only *what* was said.

**Nimo** is a memory system designed around a different unit of retention: the **evidence-backed memory node**, connected by typed, directional **associations**, governed by explicit **write, retrieval, and deletion rules**, and complemented by **procedural skills** distilled from tool-using experience. It runs in a single SQLite file, requires no external embedding service, and exposes its capabilities as typed tools that any AI-SDK-compatible agent can call.

The system is deliberately conservative. Retrieval is **read-only**: reading a memory does not strengthen it. Contradictions are **preserved and linked**, not silently resolved. Destructive operations require **explicit confirmation**. Owner identity is supplied by the host and is never accepted from the model. These choices trade some apparent "intelligence" for auditability, reversibility, and trust.

We report the current implementation honestly: a 6-axis universal suite passes 62/62 questions, and a retrieval benchmark passes all 18 questions in its hybrid configurations. Both corpora were authored alongside the system and are **not blind**, so the numbers are regression evidence, not research-grade proof. The contribution is the architecture and its verified behaviour, not a claim of state-of-the-art retrieval.

---

## 1. Introduction

An agent without memory is a sequence of isolated guesses. An agent with a transcript is slightly better, but a transcript is not memory: it is a log. It has no notion of importance, no distinction between a user's assertion and the assistant's speculation, no links between related decisions, and no safe way to forget.

The memory problem for agents has four parts:

1. **What should be retained?** Not every token deserves permanence. A question is not a fact. An assistant's claim is not independent evidence. A password must never be stored.
2. **How should it be found?** Exact keyword search misses paraphrase. Dense similarity misses structure and provenance. A useful system needs several retrieval signals and a way to combine them.
3. **How should it change?** New information may duplicate, support, contradict, or supersede an existing memory. These are different operations and must not collapse into "overwrite the row".
4. **How should it be removed?** Deletion must reach content, embeddings, edges, revisions, indexes, and derived summaries — without destroying the audit trail that proves the deletion happened.

Nimo addresses these questions with five layers that are kept separate: **experience**, **memory**, **association**, **index**, and **governance**. The separation is the design. A message is an experience; a fact extracted from it is a memory; a relationship between memories is an edge; a retrieval index is a view; and a policy decides what may cross each boundary.

The system is also intended to be **useful to other agents**, not only to this repository's server. Its public package exports the memory service, request-scoped identity helpers, prompt-context builders, and mode-split tool sets. A host agent supplies an owner identity and a mode; Nimo supplies persistent, governed memory.

### 1.1 Contributions

- **A five-layer memory architecture** with explicit boundaries between evidence, belief, association, index, and governance.
- **Evidence-aware ingestion**: rule-based extraction, speech-act filtering, secret detection, source attribution, and confidence derived from provenance rather than repetition.
- **Conservative conflict handling**: similarity, contradiction, and supersession are classified separately; contradictions are retained and linked.
- **Hybrid retrieval with a bounded associative step**: BM25, entity matching, and hashed char n-gram embeddings fused by Reciprocal Rank Fusion, followed by bounded spreading activation over typed edges.
- **A redesigned deterministic ranking function** that removes an unimplemented PageRank term and combines relevance, importance/degree, recency, and confidence with stated weights.
- **Read-only recall**: retrieval never writes confidence, importance, degree, access counters, or edges.
- **Governed deletion**: transactional forgetting that clears content, embeddings, edges, revisions, and FTS rows while preserving a non-sensitive audit record.
- **Procedural memory**: candidate skills distilled from tool-using turns, rehearsed through outcomes, curated by a lifecycle policy, and selected with a UCB bandit.
- **A hardened coding-tool layer**: sandboxed file operations, structured process execution, automatic test detection, git inspection, source outlining, dry-run refactoring, and atomic writes.

### 1.2 What this document is not

This is not a claim that Nimo is conscious, generally intelligent, or a complete cognitive architecture. It is not a claim that the graph always beats a vector baseline. It is not a claim that the current benchmark is blind or definitive. Section 8 lists the limitations explicitly.

---

## 2. Design Principles

| Principle | Consequence in the implementation |
| --- | --- |
| **Evidence before belief** | Every memory carries provenance: an experience id, source kind, quote, and observation time. Assistant output is preserved for continuity but is not treated as independent evidence. |
| **One continuous stream** | There are no conversation buckets. Experiences are global to an owner, and retrieval is by content, entity, embedding, and graph relation. |
| **Structure over similarity alone** | Typed nodes and typed edges are first-class. Similarity is one retrieval signal, not the data model. |
| **Governance at the write boundary** | Secret detection, speech-act filtering, and policy checks run before storage, not after retrieval. |
| **Reading must not change belief** | Recall is read-only. Rehearsal is an explicit write. |
| **Contradictions are data** | Conflicting memories are preserved with a `contradicts` edge. The system may lower confidence; it does not pretend the conflict never existed. |
| **Deletion is a graph operation** | Forgetting removes or redacts every derived representation and verifies that recall no longer returns the memory. |
| **Identity belongs to the host** | The model never supplies an owner id. Request-scoped context carries the authenticated identity and mode. |
| **Deterministic where possible** | Hashing embeddings, BM25, RRF, and ranking are local arithmetic. No hidden API, no model download, no GPU requirement. |
| **The workspace is trusted code** | The tool sandbox prevents traversal and shell injection; it is not a virtual machine. Do not point it at an untrusted repository. |

---

## 3. System Overview

```text
User turn
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ Agent runtime (packages/agents)                              │
│  runAgent(prompt, mode, model, effort, { ownerId })          │
│    ├─ establish request-scoped identity + permissions        │
│    ├─ buildMemoryContext(ownerId, prompt)                    │
│    ├─ loadSkills(ownerId, prompt, 3)                         │
│    ├─ generateText(... tools from mode ...)                  │
│    └─ record the turn as an experience                       │
└──────────────────────────────────────────────────────────────┘
   │                                   ▲
   │ tool calls                        │ context block
   ▼                                   │
┌───────────────────────────────┐   ┌──────────────────────────┐
│ Tool layer                    │   │ Memory engine (PAME)     │
│  filesystem · code · research │──▶│  recall · remember ·     │
│  memory read/write/destructive│   │  link · teach · forget   │
└───────────────────────────────┘   └───────────┬──────────────┘
                                                │
                                                ▼
                                   ┌──────────────────────────┐
                                   │ ~/.nimo/pame.db (SQLite) │
                                   │ experiments · memories · │
                                   │ edges · entities ·       │
                                   │ policies · revisions ·   │
                                   │ audit · jobs · skills    │
                                   └──────────────────────────┘
```

### 3.1 The five layers

1. **Experience layer** — what actually happened: user messages, assistant responses, tool calls, tool results, observations, timestamps. Experiences are hashed for deduplication and retained as evidence.
2. **Memory layer** — what Nimo believes is worth retaining: facts, preferences, decisions, events, concepts, procedures, goals, observations. Each node has confidence, importance, retention class, validity interval, and evidence.
3. **Association layer** — typed, directional, weighted edges: `supports`, `contradicts`, `supersedes`, `causes`, `enables`, `observes`, `tests`, `replicates`, `related_to`, `depends_on`, and others. Degree is tracked and repairable.
4. **Index layer** — how memories are found: BM25/FTS text evidence, entity names, hashed char n-gram embeddings, recency, and graph activation. Indexes are derived; they never replace the source of truth.
5. **Governance layer** — what may be stored, changed, retrieved, shared, or forgotten. It owns secret detection, owner scoping, mode permissions, deletion, retention, and audit.

### 3.2 Storage

One SQLite database, WAL mode, owner-scoped queries. The default path is `~/.nimo/pame.db`; `PAME_DB_PATH` overrides the file, and `PAME_DATA_DIR` overrides the root. The database resolves lazily and can be closed and reopened cleanly.

| Table | Responsibility |
| --- | --- |
| `experiences` | Original interaction evidence, hashed for deduplication |
| `memories` | Consolidated, typed, versioned memory nodes |
| `memory_edges` | Typed, directional relationships with weight and confidence |
| `memory_entities` | Canonical people, projects, technologies, concepts |
| `memory_policies` | Per-owner governance settings |
| `memory_revisions` | Version history; the original is never silently rewritten |
| `memory_audit` | Operation history without stored secrets |
| `memory_jobs` | Durable ingestion, embedding, and maintenance queue |
| `skills` | Procedures with use/success/failure counts and confidence |

There is no MongoDB or Neo4j dependency. The graph is represented in SQLite with explicit `from`/`to` edges and indexed adjacency queries.

---

## 4. How Nimo Memory Works

### 4.1 Capture: one endless stream

Every turn is written as an `Experience`. The content is hashed so identical turns can be detected, but capture deliberately salts the hash so repeated identical turns remain distinguishable as separate experiences. Consolidation, not capture, is responsible for deciding that two turns express the same memory.

The agent loop records:

- the user's prompt as first-hand evidence;
- the assistant's final text for continuity (but extraction yields no independent facts from assistant text);
- the tools that were actually called, which are later used to decide whether a procedure is worth distilling.

This is why "Chat" and "Plan" can still learn even though their **memory tools** are read-only: the runtime's internal capture path is separate from the model-callable tool surface. The model cannot use a tool to write in Chat/Plan, but the host may still preserve the turn.

### 4.2 Extraction and validation

Extraction is deterministic and rule-based. It does not call an LLM, which makes it testable and reproducible. The pipeline distinguishes:

- **Questions** — not facts. "Which database did we choose?" is a retrieval cue, not a durable assertion.
- **Instructions** — not facts. "Fix the failing test" is a task, not a belief.
- **Hedged statements** — retained as `inferred` with lower confidence. "It might be SQLite" is weaker than "We chose SQLite".
- **User assertions** — the primary source of durable facts.
- **Assistant/system output** — preserved as experience, but not treated as independent evidence.
- **Tool/document evidence** — labelled with lower confidence and source attribution.
- **Identity facts** — stable by policy; they do not fade like ordinary memories.
- **Denials / ephemeral agent state** — rejected at ingestion; a passing "I don't know" should not become a permanent belief.

Before storage, every candidate passes the governance layer:

- secret and credential detection;
- owner scoping;
- retention and visibility classification;
- duplicate and near-duplicate detection;
- evidence construction with `experienceId`, `kind`, `quote`, and `observedAt`.

### 4.3 Consolidation: merge, support, contradict, supersede

Consolidation is intentionally conservative. Given a new candidate and an existing memory, the engine asks what kind of relationship the evidence supports:

| Situation | Action |
| --- | --- |
| Exact or near-exact duplicate | Attach new evidence, raise confidence/importance within policy, record a revision |
| Strong keyword overlap, same type, long content | Treat as the same memory and merge evidence |
| Logical contradiction (value-slot conflict, negation, numeric/entity change) | Keep both memories, add a `contradicts` edge, do not merge |
| Explicit correction or verified replacement | Mark the old memory `superseded`, record a revision, preserve historical content |
| Merely related | Create a typed `related_to` / `supports` / `depends_on` edge to the closest active memory |
| Ambiguous | Keep both; do not invent certainty |

Two rules matter more than the rest:

1. **Similarity is not contradiction.** Two sentences can share most of their words and disagree about a value. The conflict classifier separates lexical similarity from actual value conflict.
2. **Repetition is not evidence.** Retrieving the same memory repeatedly must not raise its confidence. Confidence is about provenance quality, not frequency of access.

The current classifier is heuristic. Nuanced prose contradictions can still be missed. There is no LLM/NLI judge. This is recorded as a partial implementation, not a solved problem.

### 4.4 The association graph

Memories are nodes; relationships are typed edges with weight and confidence. The graph supports:

- **Association** — related facts surface together.
- **Explanation** — a retrieved memory can be followed to the evidence and related decisions that support it.
- **Spreading activation** — connected memories that share no query words can still surface.
- **Conflict visibility** — contradictions are edges, not deletions.
- **Degree-aware importance** — well-connected memories receive a modest ranking boost.
- **Repair** — dangling edges and inconsistent degree counts can be detected and fixed.

The graph is deliberately not used as a license for unbounded traversal. Activation is bounded in hops and decayed per step so a large graph cannot turn into a runaway walk.

### 4.5 Retrieval: candidates, fusion, activation

Retrieval is a five-stage pipeline:

1. **Query cues** — the user's message becomes tokens, entity names, and an embedding.
2. **Candidate generation** — three independent ranked lists:
   - **BM25 keyword**: `score += idf · (f·(k₁+1)) / (f + k₁(1−b+b·docLen/avgLen))`, with `k₁ = 1.5`, `b = 0.75`.
   - **Entity match**: exact canonical entity names.
   - **Embedding cosine**: `cos(u,v) = u·v/(‖u‖‖v‖)` over deterministic hashed char n-gram vectors (dimension 256). Morphological relatives share buckets, so "automobile" and "automobiles" can fire together.
3. **Fusion** — Reciprocal Rank Fusion over the candidate lists:

   ```text
   RRF(d) = Σ 1 / (60 + rank_i(d))
   ```

   RRF is robust to score-scale differences between BM25 and cosine, and it rewards documents that appear in multiple lists.

4. **Associative activation** — bounded spreading activation from the fused seeds:

   ```text
   A(v) = S(v, q) + λ · Σ w(u,v) · A(u)
   ```

   with `λ = 0.5` and a per-hop decay of `0.6`, bounded to at most four hops. `S(v,q)` is the fused seed score and `w(u,v)` is the edge weight. This is **not** Personalized PageRank; there is no PageRank computation in the engine. The legacy `page_rank` column exists for historical data and is not read by ranking.

5. **Assembly** — a compact prompt block is built: current activity (newest first), relevant skills, recalled memories, and evidence. The prompt never receives the whole graph.

The embedding is a dependency-free hashed char n-gram representation, not a dense neural embedding. It is deterministic, persistent in SQLite, and survives restarts. Dense embeddings and cross-encoder rerankers are explicitly out of scope.

### 4.6 Ranking

After candidates are retrieved, the deterministic ranking function is:

```text
score = 0.35 · relevance
      + 0.40 · (base / 2)
      + 0.15 · effectiveRecency
      + 0.10 · confidence

base = importance · (1 + ln(1 + degree))
```

- `relevance` is the normalised fused retrieval score.
- `base` rewards important and well-connected memories, normalised by 2 so the term stays in a comparable range.
- `effectiveRecency` is `1` for stable memories; ephemeral memories are multiplied by `0.3` so temporary observations do not outrank durable knowledge.
- `confidence` reflects evidence quality and provenance, not repetition.

There is no hidden term and no non-deterministic reranker. The previous design included a PageRank weight that could never be non-zero because nothing computed it; that term was removed and the remaining weights were renormalised.

### 4.7 Decay, retention, and read-only recall

Ageing follows a forgetting curve:

```text
s(t) = s₀ / (1 + age/τ),    τ = 30 days × (1 + importance)
```

Age is computed from `lastAccessedAt` when present, falling back to `updatedAt`. The crucial rule is:

> **Retrieval is read-only.** Recall never writes `lastAccessedAt`, confidence, importance, degree, access counters, or edges.

This prevents a feedback loop in which repeatedly asking about a memory makes it permanently true or permanently prominent. Rehearsal must be an explicit write: a correction, a consolidation, a deliberate touch, or a skill outcome. Neglect still fades; reading alone does not refresh.

Retention has three classes:

- **stable** — identity facts, decisions, durable preferences; never timer-deleted.
- **normal** — ordinary memories; subject to decay-based ranking but not automatic deletion.
- **ephemeral** — temporary observations; archived when expired, with a reduced recency weight while active.

A retention worker archives expired ephemeral memories, redacts old experience bodies, and prunes old revisions. It never timer-deletes stable memories.

### 4.8 Procedural memory: skills

Facts tell an agent what is true. Skills tell it what to do. A skill is a procedure with a track record:

```text
name, whenToUse, steps[], toolsUsed[], keywords[],
status: candidate | active | archived,
uses, successes, failures, confidence, lastAccessedAt
```

The lifecycle is:

1. **Distillation** — when a tool-using turn occurs and no loaded skill covered it, the turn can be distilled into a candidate skill. Steps come from the response, tools from the actual tool calls, and keywords from the prompt.
2. **Rehearsal** — `useSkill(success)` increments uses and the appropriate outcome count, updates confidence, and records the rehearsal time.
3. **Curation** — every turn with skills present runs the lifecycle:
   - candidate with at least one success → **promote** to active;
   - active with at least three failures and more failures than successes → **archive**;
   - active with more failures than successes and confidence below `0.4` → **demote** to candidate;
   - otherwise → **keep**.
4. **Selection** — each skill is an arm of a multi-armed bandit. The posterior is `Beta(α = 1 + successes, β = 1 + failures)`, and selection uses:

   ```text
   UCB = μ + sqrt(2 · ln(t) / n)
   ```

   where `μ = α/(α+β)`, `t` is total uses, and `n` is the arm's uses. This is exploration with a preference for skills that have worked.

5. **Composition** — two active, confident skills can compose into a macro-skill when their keyword overlap is at least `0.6` and both confidences are at least `0.6`. This is chunking: a repeated sequence becomes one reusable procedure.

Skills are stored in the same SQLite database and are owner-scoped. Policy gates apply to skill distillation, so a secret cannot be laundered into a procedure.

### 4.9 Governance, identity, and deletion

**Identity.** The host establishes an owner per request through `AsyncLocalStorage`. The model never supplies an owner id. In `PAME_MULTI_USER=true` mode, an unauthenticated request is denied with `no_identity`. In single-user local development, the deliberate fallback owner is `local`; this is a documented convenience, not an authentication mechanism.

**Mode permissions.** Tools enforce permissions at execution time, not only in the prompt:

- `Chat` — memory read + research; memory writes are not exposed.
- `Plan` — read-only orientation + memory read + research.
- `Auto` — read/write + memory read/write/destructive + research.

Destructive memory operations additionally require `destructiveConfirmed=true` from the host. The model cannot set that flag.

**Secrets.** Detection combines patterns and assignment heuristics. It runs on create, update, teach, skill distillation, and ingestion. Talking *about* passwords or a "token budget" is not automatically flagged; an actual credential assignment is.

**Retrieved memories are untrusted input.** They are fenced and labelled as evidence. A retrieved memory must not be able to override system instructions, tool permissions, or security policy.

**Deletion.** Forgetting is transactional and idempotent:

```text
find → confirm → clear content/summary/keywords/evidence/embedding
     → redact revisions
     → remove edges
     → redact exclusive experiences
     → remove FTS row
     → preserve a non-sensitive audit record
     → verify recall no longer returns the memory
```

Bulk deletion defaults to a preview. `forgetByQuery` only deletes exact direct matches after `{ confirm: true }`; graph-only neighbours are never swept in. A partial failure must not leave a searchable deleted memory.

### 4.10 Durable jobs

Ingestion, embedding, maintenance, and retention work through `memory_jobs` rows with attempts, backoff, claim, done/dead status, and stale-job recovery. This is a real SQLite queue, not a fake "job created" response. Failed jobs dead-letter with their error instead of retrying forever.

---

## 5. Why This Is Useful for Other Agents

Nimo is packaged as a library, not only as this repository's server. A host agent can use it without adopting the agent loop, the model registry, or the UI.

### 5.1 What a host gets

| Property | Why it matters |
| --- | --- |
| **Persistent, structured memory** | Decisions, preferences, facts, events, procedures, and goals survive restarts and model changes. |
| **Evidence and audit** | Every memory can be traced to an experience and a quote. Mutations are audited. |
| **Owner isolation** | The host supplies the identity; the model cannot forge it. Concurrent requests do not share `AsyncLocalStorage` state. |
| **Mode-aware tools** | Read-only, read/write, and destructive capabilities are separated into distinct tool sets. |
| **Read-only recall** | Retrieval cannot silently reinforce a belief. |
| **Safe forgetting** | Deletion is a graph-wide operation with a verification step. |
| **No external services** | SQLite + deterministic arithmetic. No vector database, embedding API, Redis, or GPU. |
| **Portable** | `PAME_DB_PATH` / `PAME_DATA_DIR` / `~/.nimo` defaults; clean reopen. |
| **Agent-agnostic** | The public surface is typed functions and AI-SDK tools, not a specific model or UI. |
| **Procedural learning** | Tool-using turns can become skills with outcomes, not just chat history. |

### 5.2 Integration shape

The host must do two things: establish a request context and choose a tool set.

```ts
import {
  memoryService,
  memoryReadTools,
  memoryWriteTools,
  memoryDestructiveTools,
  buildMemoryContext,
  runWithMemoryContext,
} from "@workspace/memory";

// 1. The host authenticates the user and supplies the owner.
await runWithMemoryContext(
  { ownerId: authenticatedUserId, mode: "Auto", destructiveConfirmed: false },
  async () => {
    // 2. Build a compact prompt block from relevant memory.
    const ctx = buildMemoryContext(authenticatedUserId, userPrompt);

    // 3. Give the model only the capabilities this mode allows.
    const tools = {
      ...memoryReadTools,
      ...memoryWriteTools,
      // ...memoryDestructiveTools, only when the host supports confirmation
    };

    // 4. Call the model with the memory block and tools.
    const result = await generateText({ model, system: ctx.promptBlock, prompt: userPrompt, tools });

    // 5. Preserve the turn. This is separate from model-callable writes.
    memoryService.remember({
      ownerId: authenticatedUserId,
      content: userPrompt,
      type: "message",
      role: "user",
    });
    return result;
  },
);
```

The exact imports and tool names are stable; the host is free to wrap them, rename them, or expose only a subset.

### 5.3 Scenarios

- **Coding agent** — remembers architectural decisions, rejected approaches, project conventions, and recurring test commands. The upgraded tool layer lets it read, search, edit, run, and verify code in the workspace.
- **Research assistant** — retains sourced claims, contradictions, and open questions; distinguishes evidence from inference.
- **Support agent** — remembers a customer's preferences and prior resolutions, while enforcing owner isolation and safe deletion.
- **Robotics / simulation** — stores `sensor`, `trajectory`, `hypothesis`, and `experiment` nodes and typed `causes` / `enables` / `observes` / `tests` / `replicates` edges. The substrate is task-agnostic; embodiment and control are not implemented.
- **Multi-agent system** — each agent gets an owner-scoped view; shared memory requires an explicit host policy, not a model decision.

### 5.4 What "better than a vector bag" means here

A vector bag retrieves by similarity. Nimo retrieves by similarity **and** structure:

- a decision can surface because it is connected to the project that depends on it;
- a contradiction can surface instead of being averaged away;
- a procedure can surface because it succeeded before, not because its wording is close;
- a deleted memory actually disappears from every derived index;
- a retrieved memory carries provenance, so the agent can say *why* it believes it.

This is not a claim that the graph always wins. On the current synthetic retrieval benchmark, the graph configuration ties the non-graph hybrid configuration at 100% Recall / 1.000 MRR. The graph's value is explanatory and multi-hop; the benchmark does not yet demonstrate a measurable lift on this corpus.

---

## 6. Evaluation

### 6.1 Test suites

All numbers below were produced in isolated temporary databases on 2026-11-12. The real `~/.nimo/pame.db` was not used.

| Suite | Checks | Result |
| --- | ---: | --- |
| AGI | 154 | 154/154 |
| Dreamer | 28 | 28/28 |
| Formula | 23 | 23/23 |
| Capture dedup | 7 | 7/7 |
| Evolution | 20 | 20/20 |
| Hardening | 82 | 82/82 |
| **Total** | **314** | **314/314** |

The hardening suite covers identity, mode permissions, secret blocking, extraction, conflicts, deletion, bulk-deletion preview, read-only recall, degree/dangling-edge repair, noise gating, truncation reporting, transactions, portability, retention, jobs, and prompt-injection fencing.

### 6.2 Retrieval benchmark

18 questions, including 2 negative questions that should return no answer.

| Configuration | Recall | MRR | No-answer accuracy |
| --- | ---: | ---: | ---: |
| Vector only (hashed n-grams) | 88.9% | 0.747 | 0% |
| Vector + keyword + entity (RRF) | 100% | 1.000 | 100% |
| Hybrid + graph activation | 100% | 1.000 | 100% |

Interpretation: the non-vector signals matter. Vector-only retrieval misses paraphrase/lexical cases and, more importantly in this corpus, answers negative questions it should reject. Adding BM25, entity matching, and the noise gate fixes both. Graph activation does not add a measured lift on this small synthetic corpus; it remains valuable for multi-hop and explanation, but that value is not demonstrated by these numbers.

### 6.3 Universal benchmark

62 questions across six axes, 100% pass:

| Axis | Questions | Result |
| --- | ---: | ---: |
| Memory | 12 | 100% |
| Research | 10 | 100% |
| Coding | 10 | 100% |
| Robotics | 10 | 100% |
| Adaptation | 10 | 100% |
| Forgetting | 10 | 100% |
| **Total** | **62** | **100%** |

No-answer accuracy was 100%. The suite includes negative questions, so a system that always returns something does not pass automatically.

### 6.4 What the evidence does and does not show

**Shows:**

- The implementation passes its own regression and hardening suites.
- Hybrid retrieval beats vector-only on the authored corpus.
- Read-only recall, secret blocking, deletion, and mode permissions are enforced in code and tested.
- The universal suite exercises memory, research, coding, robotics, adaptation, and forgetting.

**Does not show:**

- State-of-the-art retrieval. The corpus is synthetic and was authored alongside the system.
- Blind generalization. A blind corpus written by someone who did not build the system has not been run.
- That the graph beats a simpler baseline on real-world data. On this corpus it ties the non-graph hybrid configuration.
- That hashed n-gram embeddings are competitive with dense embeddings. They are a dependency-free stand-in.

These limitations are part of the result, not a footnote to hide.

---

## 7. The Agent Tool Layer (`packages/agents/src/tools`)

The agent harness exposes **20 non-memory tools** plus **12 memory tools** (32 total in `Auto`). The tool layer was designed around a simple question: can an agent actually do software work — read a file, find a symbol, make a targeted edit, run the tests, inspect the diff, and recover from failure — without giving it an unrestricted shell?

### 7.1 Design goals

- **Safe by construction** — no shell interpolation, no path traversal, no secret reads, no accidental overwrite.
- **Preview before destruction** — destructive tools support `dryRun`; refactoring is dry-run by default.
- **Structured output** — tools return `success`, `exitCode`, `durationMs`, counts, and failure lines, not an opaque text blob.
- **Useful truncation** — large outputs keep the tail, where build and test errors usually are.
- **Atomic writes** — a crash cannot leave a half-written source file.
- **Mode-aware permissions** — enforced at execution, not just by hiding tools from the prompt.
- **Local project awareness** — commands see `node_modules/.bin`, so `tsc`, `eslint`, and `vitest` resolve like they do in an npm script.

### 7.2 Filesystem tools (8)

| Tool | What it does | Safety / capability |
| --- | --- | --- |
| `listFiles` | List a directory, optionally recursive | Glob filters, depth limit, size/mtime metadata, sorting, hides dotfiles by default, skips `node_modules`/`.git`/build output/symlinks/secrets |
| `readFile` | Read a text file | Line numbers, `offset`/`limit` paging, binary detection, byte cap, `nextOffset` for continuation, secrets blocked |
| `writeFile` | Create or overwrite a file | Creates parent directories, refuses overwrite unless `overwrite=true`, atomic temp-file + rename |
| `editFile` | Exact-string replacement | Requires a unique match by default, `replaceAll` for deliberate global edits, CRLF/LF adaptation, `dryRun` preview, atomic write |
| `search` | Search file contents | Plain or regex, case sensitivity, whole-word, include/exclude globs, context lines, `content`/`files`/`count` modes, binary/secret skipping |
| `deleteFile` | Delete one file | Refuses directories, symlinks, `.git`, secrets, memory-store files; `dryRun` |
| `mkdir` | Create a directory | Recursive, idempotent, write-permission checked |
| `deleteDir` | Delete a directory recursively | Cannot delete the workspace root; `dryRun` lists entries first |

### 7.3 Code tools (9)

| Tool | What it does | Notable behaviour |
| --- | --- | --- |
| `runCommand` | Run an allowlisted dev command | Argv or tokenised command, no shell, local `.bin` on PATH, scrubbed env, timeout + process-tree kill, capped tail output |
| `runTests` | Run the project's tests or typecheck | `auto` detects the package manager and `package.json` test script (or tsconfig), extracts pass/fail counts and failure lines |
| `gitStatus` | Inspect git state | `status`, `diff`, `diff-stat`, `log`, `show`, `branch`; staged/ref filters; read-only |
| `explainFile` | Outline a source file | Imports, exports, functions, classes, methods, interfaces, types, line ranges; TypeScript/JavaScript detail, Python, generic fallback |
| `refactor` | Cross-file find-and-replace | Dry-run by default, glob include/exclude, per-file counts and previews, atomic writes, permission checked |
| `benchmark` | Time a command repeatedly | Warmup runs, mean/median/min/max/p95/stddev, failure detection |
| `createTool` | Create a workspace tool | Writes `tools/foundry/<name>.ts`, refuses overwrite, validates `tool({ execute })` shape, optional typecheck when a tsconfig exists |
| `listWorkspaceTools` | Discover foundry tools | Name, path, description, size, mtime |
| `callWorkspaceTool` | Execute a foundry tool | Dynamic `file://` import, JSON arguments, structured error reporting |

### 7.4 Research tools (3)

`webFetch`, `extractData`, and `summarize` provide web retrieval and extraction. They are registered as research tools and are available in all three modes. They are separate from the memory engine's governance; the agent should treat fetched content as untrusted evidence.

### 7.5 Memory tools (12, from `@workspace/memory`)

| Read | Write | Destructive |
| --- | --- | --- |
| `recall` | `remember` | `forgetMemory` |
| `getRelatedMemories` | `linkMemories` | |
| `getMemoryHistory` | `updateMemory` | |
| `loadSkills` | `teach` | |
| `getRecent` | `teachSkill` | |
| | `useSkill` | |

### 7.6 Mode surface (actual counts)

| Mode | Tools | Composition |
| --- | ---: | --- |
| `Chat` | 8 | 5 memory read + 3 research |
| `Plan` | 14 | 6 read (`listFiles`, `readFile`, `search`, `explainFile`, `listWorkspaceTools`, `callWorkspaceTool`) + 5 memory read + 3 research |
| `Auto` | 32 | 6 read + 11 write/code + 12 memory + 3 research |

The memory tool split is intentional. Chat and Plan can recall, but cannot call `remember`, `linkMemories`, `updateMemory`, `teach`, `teachSkill`, or `useSkill`; `forgetMemory` is destructive and additionally requires host confirmation.

### 7.7 Workspace and file safety

- Default workspace root: `~/.nimo` (`os.homedir()`), overridable with `AGENT_WORKSPACE`.
- Paths are resolved inside the root. Traversal (`../`), absolute paths outside the root, NUL bytes, and symlink escapes are rejected.
- `.env*`, private keys, credentials, `.npmrc`, `.netrc`, service-account JSON, and similar files are blocked from read and write.
- `.git`, the memory store, and the database files are protected from file-tool writes.
- Binary files are detected by a NUL-byte sample and are not silently decoded.
- The walker skips `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, coverage, virtual environments, and other generated trees.

### 7.8 Process safety

`runCommand`, `runTests`, `gitStatus`, and `benchmark` share one hardened process runner:

- **Allowlisted executables** — git, node, npm, pnpm, yarn, bun, tsx, tsc, vitest, jest, eslint, prettier, next, vite, turbo, esbuild, webpack, rollup, Python, Go, Rust, Java, .NET, and a few read-only shell basics. Extend with `AGENT_SHELL_ALLOW`.
- **No shell interpolation** — commands are tokenised into an argv array. `&&`, `||`, `|`, `;`, `>`, `>>`, and `<` as standalone tokens are rejected. Use the dedicated search/read/write tools instead of pipelines.
- **Windows `.cmd` shims** — the runner resolves the absolute executable path and passes it to `cmd.exe`, so npm/pnpm shims keep their `%~dp0` install directory. Environment-variable expansion (`%VAR%`), literal quotes, NUL, and line breaks are rejected.
- **Scrubbed environment** — API keys and credentials never reach child processes. Only PATH, home directories, temp, locale, and similar non-secret variables are kept.
- **Deterministic output** — `CI=1`, `NO_COLOR=1`, `FORCE_COLOR=0`, `GIT_PAGER=cat`, `PAGER=cat`.
- **Timeout and process-tree kill** — a hard timeout kills the child and its descendants, so a hung build does not hang the agent.
- **Bounded output** — per-stream byte caps keep the tail, preserving the part where errors usually appear.

### 7.9 Permissions

Filesystem writes and shell execution are gated by the request-scoped mode:

```ts
// packages/agents/src/tools/shared/permissions.ts
canWriteFiles()  // AGENT_ALLOW_WRITE=true OR active mode === "Auto"
canRunShell()    // AGENT_ALLOW_SHELL=true OR active mode === "Auto"
```

The mode comes from the memory runtime context established by `runAgent()`. `AGENT_ALLOW_WRITE` and `AGENT_ALLOW_SHELL` remain explicit overrides for CLI or test runs where no agent context exists. Tools call `assertCanWrite()` / `assertCanRunShell()` at execution time, so a model cannot talk its way into a write by pretending to be in Auto mode.

### 7.10 Tool foundry and its trust boundary

`createTool` writes an ordinary TypeScript file under `<workspace>/tools/foundry/`. `listWorkspaceTools` discovers it; `callWorkspaceTool` imports it through `pathToFileURL()` (required on Windows) and invokes its `execute` function.

Important boundary: **foundry tools are trusted code with Node privileges.** They are not executed inside a separate VM or permission sandbox. `createTool` validates the expected shape and optionally typechecks when the workspace has a `tsconfig.json`, but a malicious tool can still do anything the agent process can do. Only create foundry tools from trusted prompts or review the generated file before calling it.

The foundry is a convenience for capturing repeated operations, not a security boundary.

---

## 8. Limitations and Non-Claims

1. **The benchmark is not blind.** The retrieval and universal corpora were authored alongside the system. The numbers are regression evidence, not an independent evaluation.
2. **The graph does not beat the non-graph hybrid on the current corpus.** Both achieve 100% Recall / 1.000 MRR. Multi-hop value is plausible and structurally supported, but not demonstrated here.
3. **Embeddings are hashed char n-grams, not dense vectors.** They are deterministic and dependency-free. A dense embedding model would likely improve paraphrase retrieval, at the cost of an external service or model download.
4. **Conflict detection is heuristic.** Nuanced prose contradictions can be missed. There is no NLI judge.
5. **Evolution is conservative, not fully autonomous.** Supersession requires an explicit correction or verified replacement. Some phrasings will not trigger it.
6. **PAME does not implement authentication.** It consumes an identity supplied by the host. `PAME_MULTI_USER=true` makes a missing identity a hard denial, but login, sessions, and token verification are the host's responsibility.
7. **The tool sandbox is not a VM.** It blocks traversal, secrets, shell metacharacters, and dangerous commands, but the workspace and its package scripts are trusted code. Do not run it against an untrusted repository.
8. **Foundry tools are trusted code.** `callWorkspaceTool` runs them with full Node privileges.
9. **Robotics is a substrate, not a robot.** `sensor`, `trajectory`, `hypothesis`, and `experiment` nodes exist; there is no simulator, controller, or physical embodiment.
10. **Working memory is approximate.** There is no dedicated working-memory type; ephemeral retention plus recent experiences approximate it.
11. **No concurrency stress test.** SQLite serialises writes in this single-process design, but an explicit two-writer timestamp test is not present.
12. **No dashboard.** Jobs, audit, and revisions are observable through the database and tests, not through an operations UI.

---

## 9. Reproducing the Results

```bash
# Install
pnpm install

# Typecheck all packages
pnpm typecheck

# Memory suites (AGI, Dreamer, Formula, Capture, Evolution, Hardening, retrieval)
pnpm --filter @workspace/memory test:all

# Universal 6-axis suite
pnpm --filter @workspace/memory test:universal

# Individual suites
pnpm --filter @workspace/memory test
pnpm --filter @workspace/memory test:dreamer
pnpm --filter @workspace/memory test:formula
pnpm --filter @workspace/memory test:capture
pnpm --filter @workspace/memory test:evolve
pnpm --filter @workspace/memory test:hardening
pnpm --filter @workspace/memory test:benchmark
```

Tests use isolated temporary databases. They must never touch the real `~/.nimo/pame.db`.

To point a manual run at a disposable workspace and database:

```bash
AGENT_WORKSPACE=.tmp/pame-test \
PAME_DB_PATH=.tmp/pame-test/pame.db \
pnpm --filter @workspace/server dev
```

---

## 10. Repository Layout, Setup, and Run

### 10.1 Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | `>=20.9.0` | `engines` in root `package.json` |
| pnpm | `11.25.0` | `packageManager` in root `package.json` |
| Bun | `>=1.3.0` | Only for the CLI (`apps/cli`) |

### 10.2 Install and build

```bash
pnpm install
pnpm build        # turbo build
pnpm dev          # turbo dev
pnpm lint
pnpm typecheck
```

### 10.3 Configuration

The server validates its environment with Zod at startup (`apps/server/src/lib/env.ts`). Create `apps/server/.env`:

```dotenv
# Required: one of the model IDs in packages/agents/src/models/registry.ts
AI_MODEL=anthropic/claude-sonnet-4-5

# Provider key(s) — set only the one(s) you use
ANTHROPIC_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
# Ollama (local) needs no key

# Optional server
PORT=4000
HOST=127.0.0.1
```

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AI_MODEL` | Yes | — | Model used when a request omits `modelId` |
| `PORT` | No | `4000` | Server port |
| `HOST` | No | `127.0.0.1` | Server host |
| provider keys | If used | — | Only the provider you use |
| `PAME_OWNER_ID` | No | `local` | Local-dev owner scope |
| `AGENT_WORKSPACE` | No | `~/.nimo` | Workspace root; also used for the default DB root |
| `PAME_DATA_DIR` | No | — | Fallback DB root |
| `PAME_DB_PATH` | No | `<root>/pame.db` | Exact database file |
| `PAME_MULTI_USER` | No | unset | Set `true` to require an authenticated owner |
| `AGENT_ALLOW_WRITE` | No | unset | Force-enable file writes outside Auto mode |
| `AGENT_ALLOW_SHELL` | No | unset | Force-enable shell tools outside Auto mode |
| `AGENT_SHELL_ALLOW` | No | unset | Comma-separated extra allowlisted executables |

Supported model IDs are defined in `packages/agents/src/models/registry.ts`. Effort levels: `none | low | medium | high`.

### 10.4 Server

```bash
pnpm --filter @workspace/server dev
# http://127.0.0.1:4000

pnpm --filter @workspace/server build
pnpm --filter @workspace/server start
```

Endpoints:

- `GET /health` — liveness and service name.
- `POST /agent` — run the agent.

```bash
curl -X POST http://127.0.0.1:4000/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Fix the failing test","mode":"Auto","effort":"medium"}'
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `prompt` | string (1–10000 chars) | Yes | |
| `mode` | `"Chat" \| "Plan" \| "Auto"` | No | Default `"Chat"` |
| `modelId` | `ModelId` | No | Defaults to `AI_MODEL` |
| `effort` | `"none" \| "low" \| "medium" \| "high"` | No | Default `"medium"` |

Response:

```json
{ "success": true, "result": { "text": "...", "usage": { "inputTokens": 0, "outputTokens": 0 } } }
```

Errors return `{ "success": false, "error": "..." }` with `400` (invalid request / model not configured) or `500` (provider / execution error).

### 10.5 CLI and web

- **CLI** (`apps/cli`) — OpenTUI terminal UI, run with `pnpm --filter @workspace/cli dev` (Bun). The UI shell renders, but the send path is not wired to `runAgent()` yet.
- **Web** (`apps/web`) — Next.js starter shell. It is not yet wired to the agent API.
- **Server** is the complete, working entrypoint.

### 10.6 Monorepo structure

```text
apps/
  cli/       # OpenTUI terminal UI (@workspace/cli)
  server/    # Express API wrapping runAgent() (@workspace/server)
  web/       # Next.js 16 app (web)
packages/
  agents/    # runAgent() runtime, models, and the tool layer
  memory/    # PAME memory engine, storage, retrieval, governance, workers
  ui/        # Shared UI components (@workspace/ui)
  eslint-config/
  typescript-config/
```

Memory internals (`packages/memory/src/`):

```text
domain/        pure types; no DB, HTTP, or SDK imports
storage/       SQLite schema, repositories, indexes
retrieval/     search, rank, rrf, activate, embed, assemble
ingestion/     capture, consolidate, extract, ingest, validate
graph/         link, traverse, evolve, conflict, planner
skills/        distill, bandit, compose
governance/    policy, forget, audit
workers/       dreamer, ingestion, maintenance, curiosity
evals/         retrieval benchmark, universal benchmark
```

The research lab lives in `packages/memory/nimo/`: `neurons/`, `synapses/`, `cortex/`, `learning/`, `recall/`, `skills/`, `memory-arena/`, `papers/`, `experiments/`, and `benchmarks/`.

---

## 11. Status

| Component | Status | Notes |
| --- | --- | --- |
| Memory engine (PAME) | **Implemented and verified** | SQLite, hybrid retrieval, governance, deletion, jobs, skills; 314/314 checks |
| Retrieval benchmark | **Implemented, limited** | 18 questions; synthetic, not blind |
| Universal benchmark | **Implemented, limited** | 62 questions / 6 axes; 100%; synthetic, not blind |
| Server | **Working entrypoint** | Express API, `POST /agent` |
| Agent tool layer | **Upgraded** | 20 non-memory tools + 12 memory tools; sandboxed file/process execution |
| CLI | **Scaffold** | UI shell; send path not wired |
| Web | **Scaffold** | Next.js shell; not wired |
| Dense embeddings / reranker / graph DB | **Unsupported** | Deliberately out of scope |
| Authentication | **Host responsibility** | PAME consumes host-provided identity |
| Robotics embodiment | **Substrate only** | Typed nodes/edges; no simulator or controller |

---

## 12. Contributing, Security, and License

**Contributing.** See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and the pull-request process. The CLI actually lives in `apps/cli`; use `pnpm --filter @workspace/cli dev` (the contributor guide may mention an older path).

**Security.** Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md). Do not run the agent against untrusted repositories: the tool sandbox prevents traversal and shell injection, but package scripts, foundry tools, and checked-out code are trusted code with process privileges.

**License.** Proprietary — © 2026 Himanshu Arodia. All rights reserved. See [LICENSE](LICENSE). Evaluation / personal non-commercial use only. No commercial use, copying, distribution, or resale without a written license; payment does not grant resale rights.
