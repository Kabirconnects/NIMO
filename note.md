# NIMO — Project Note

> **Status: experimental and incomplete.** Nimo is a research project, not a finished product. This note
> explains what exists today, what does not, and where the project is going. For the full technical
> write-up see the [README](README.md); for development setup see [CONTRIBUTING.md](CONTRIBUTING.md).

## What is NIMO?

NIMO is an experimental AI harness focused on a different kind of memory for AI systems.

Its central research component is **PAME (Nimo Associative Memory Engine)** — an experimental memory
system that explores how agents can store, retrieve, associate, evolve, and safely forget knowledge over
time. The claim being tested is not "a better chatbot". It is that an agent should not start every turn
as a stranger and should not merely accumulate chat history: it should retain evidence, connect related
knowledge, preserve contradictions, forget safely, and turn repeated procedures into reusable skills.

## Core components

- **PAME** (`packages/memory`) — the experimental associative memory engine: SQLite storage, evidence-
  backed memory nodes, typed associations, hybrid retrieval, governance, deletion, jobs, and skills.
- **Agent harness** (`packages/agents`) — `runAgent()`, the model registry, and the sandboxed tool layer
  (filesystem, code, research, and memory tools).
- **Server** (`apps/server`) — an Express API and the complete, working entrypoint today.
- **CLI** (`apps/cli`) — an OpenTUI terminal UI built with Bun.
- **Web** (`apps/web`) — a Vite + React app.
- **Shared packages** — `packages/db` (database access and settings), `packages/ui`, lint and TypeScript
  config.

## What works today

- The memory engine is implemented and passes its own regression and hardening suites (314/314 checks),
  plus the 62-question universal suite across memory, research, coding, robotics, adaptation, and
  forgetting.
- The server runs and exposes `POST /agent` backed by `runAgent()`.
- The agent tool layer can read, search, edit, run commands and tests, inspect git state, and manage
  background processes with sandboxed paths and an executable allowlist.
- Memory primitives behave as documented: read-only recall, secret blocking, owner-scoped identity,
  contradiction edges, transactional forgetting, and durable jobs.

## What does not work yet

- **The CLI is a UI shell.** It renders, but the send path is not fully wired to `runAgent()`.
- **The web app is not finished.** It is being connected to the server API and is not a complete client.
- **The benchmarks are not blind.** Both corpora were authored alongside the system, so the numbers are
  regression evidence, not independent or state-of-the-art proof. The graph ties the non-graph hybrid on
  the current corpus.
- **Some behaviour is deliberately partial.** Conflict detection is heuristic, embeddings are hashed
  char n-grams rather than dense vectors, evolution requires explicit corrections, and working memory is
  approximated rather than modelled directly.
- **There is no authentication in PAME itself.** Identity is supplied by the host; login, sessions, and
  token verification belong to the server/host layer.
- **There is no operations dashboard.** Jobs, audit, and revisions are observable through the database
  and tests.

The [README](README.md) has the full list of limitations and non-claims. They are part of the result, not
a footnote.

## Development priorities

1. Finish and validate PAME: retrieval quality, association, conflict handling, evolution, retention.
2. Wire the CLI and web app to the real agent runtime and server API.
3. Extend and, where possible, independently validate the benchmark suites.
4. Improve long-term experience accumulation and procedural skill learning.
5. Polish the UI and overall product experience once the engine is stable.

The approach is iterative: establish the underlying capabilities first, then progressively improve the
experience. Expect rough edges, moving interfaces, and incomplete features until the project is declared
finished.

## Long-term vision

Explore an AI architecture in which memory is a core part of the agent rather than an afterthought —
persistent, evidence-aware, associative, auditable, and safe to change over time.

NIMO does not currently claim AGI, consciousness, fully autonomous learning, production readiness, or
state-of-the-art retrieval. Its purpose is to research and build the foundations for more persistent and
adaptive agents.

## License

Nimo is currently under a **provisional proprietary/evaluation license** (see [LICENSE](LICENSE)):
evaluation and personal non-commercial use only, with no commercial use, copying, distribution, or resale
without a written license.

**Once the project is finished, it will be relicensed under the MIT License.** Until that change is
actually committed, the current license terms apply. The MIT plan is a stated intention, not a present
grant.
