# PAME Hardening — Implementation Checklist

**Status:** Complete for the agreed scope, with the explicit gaps recorded below.
**Last updated:** 2026-11-12
**Purpose:** Durable implementation, remediation, and verification record for PAME (Persistent Associative Memory Engine).

Legend: `[x]` implemented and covered by automated tests · `[~]` partially implemented,
scope/gaps stated · `[ ]` not done.

Every checkbox must be supportable by code that was inspected and a test run that was
recorded in the Evidence Log. No item is checked merely because code exists.

---

## Phase 0 — Baseline

- [x] `git status`, `git diff` inspected; pre-existing working-tree changes preserved.
- [x] Baseline typecheck + existing suites recorded.
- [x] Confirmed defects reproduced in isolated temporary databases (never `~/.nimo/pame.db`).

## P0 — Governance & Integrity

- [x] P0.1 Owner context + mode permissions (`src/runtime/context.ts`, tools, agent loop, server).
- [x] P0.2 Real deletion + safe bulk deletion (`governance/forget.ts`, `storage/db.ts`).
- [x] P0.3 Secret policy on every write path (`governance/policy.ts`, `ingestion/*`, `service.ts`).
- [x] P0.4 Contradiction vs similarity classifier + preservation (`graph/conflict.ts`, `ingestion/consolidate.ts`, `graph/evolve.ts`).
- [x] P0.5 Read-only recall (retrieval-time reinforcement removed).
- [x] P0.6 Real savepoints for nested transactions (`storage/db.ts`).

### P0 Acceptance Requirements

- [x] Ownership is derived from trusted request context, never model-generated identity.
- [x] Deletion removes or invalidates content, revisions, evidence, embeddings, edges and FTS rows.
- [x] Bulk deletion cannot cross ownership boundaries; neighbours are not swept in.
- [x] Secret detection applies to create, update, teach, skill distillation and ingestion.
- [x] Similarity alone never establishes logical contradiction.
- [x] Conflicting memories preserve both sides plus provenance and a `contradicts` edge.
- [x] Retrieval does not modify confidence, importance, degree or access counters.
- [x] Multi-table operations are transactional; inner failures roll back to a savepoint.

## P1 — Memory Engine Correctness

- [x] P1.1 Graph degree integrity + repair (`insertEdge`/`deleteEdge`, `repairGraphDegrees`).
- [x] P1.2 Ranking redesign (dead PageRank term removed, weights renormalised), noise gate, truncation reporting.
- [~] P1.3 Evolution correctness + integration. Conservative, classifier-driven evolution is wired into consolidation and ingestion and records revisions; nuanced prose conflicts can still be missed (no NLI judge).
- [x] P1.4 Extraction speech-act/source filtering.
- [x] P1.5 Evidence-aware confidence (provenance kind + hedges).

### P1 Acceptance Requirements

- [x] Graph relationships maintain consistent references and degree counts.
- [x] Graph repair detects and fixes corrupted degrees and dangling edges.
- [x] Ranking uses measurable, meaningful signals and is deterministic.
- [x] PageRank term removed because it could never be non-zero; documented as legacy.
- [x] Retrieval reports when results are truncated (`resultsTruncated`, `poolTruncated`, `totalActive`).
- [~] Low-quality/irrelevant memories are filtered without silently discarding useful evidence: token/FTS evidence + stopword filters + scan-cap reporting; the 5000-row scan cap is still a bounded approximation.
- [x] Evolution preserves historical revisions.
- [x] Evolution changes are audited; supersession is a status + revision change.
- [x] Extraction distinguishes facts, questions, instructions, hedges; assistant/system text yields no facts.
- [x] Source attribution (`experienceId`, `kind`, `quote`, `observedAt`) is preserved.
- [x] Confidence is based on evidence quality and provenance, not repetition.
- [x] Repeated retrieval does not increase confidence.
- [x] Uncertainty is preserved (`inferred`, lower confidence) instead of being promoted to certainty.

## Agent Safety

- [x] Mode permissions enforced inside tool execution, not just agent-loop prompts.
- [x] Destructive operations require explicit confirmation (`confirmation_required`).
- [x] Retrieved memory is fenced and labelled as untrusted evidence.
- [x] Model cannot set owner identity.
- [x] Memory tools enforce ownership independently of LLM decisions.
- [x] Tool execution validates permissions at the point of execution.
- [x] Retrieved instructions cannot close the fence or override tool permissions.
- [x] Unauthorized agents cannot access another owner's memory.
- [x] Failed authorization returns a reason code without leaking protected content.

## P2 — Operations & Infrastructure

- [x] Real job handlers + retry/backoff/dead-letter (`memory_jobs`, ingestion/maintenance workers).
- [x] Retention/maintenance (`applyRetention`, degree repair, stale-job recovery).
- [x] Portable DB paths + override (`PAME_DB_PATH` → `PAME_DATA_DIR` → `~/.nimo/pame.db`, lazy).
- [x] Persistent embeddings (SQLite column, reloaded after restart).
- [x] Docs capability labels corrected (`nimo/agent.md` §8a, `nimo/agent.memory.system.md` appendix).

### P2 Acceptance Requirements

- [x] Background jobs execute actual work (extract/consolidate, index/repair), not just report success.
- [x] Retry state is durable; failed jobs dead-letter with their error and are not retried forever.
- [x] Retention archives ephemeral memories, redacts old experiences/revisions, never timer-deletes stable memories.
- [x] Maintenance operations are transactional and idempotent.
- [x] Database paths are configurable, portable, and reopen cleanly.
- [x] Embeddings survive application restarts.
- [x] Embedding records are cleared when their memory is deleted.
- [x] Documentation distinguishes implemented, partial, planned, unsupported.

## P2.5 — Memory Architecture Requirements

### A. Memory Classification

- [x] Episodic memory: `event`, `observation`, `trajectory` node types + experiences.
- [x] Semantic memory: `fact`, `concept`, `decision` node types.
- [x] Procedural memory: `procedure` nodes and `skills`.
- [x] Preference memory: `preference` type with explicit-evidence extraction.
- [~] Working memory: no dedicated type; approximated by `ephemeral` retention + recent experiences.
- [x] Associative memory: typed `memory_edges`.
- [x] Categories coexist (a node has a type + retention class + optional edges).

### B. Provenance & Evidence

- [x] Important memories retain `evidence[]` with experience id, kind, quote, timestamp.
- [~] Original evidence is traceable to the experience record; full conversation-message replay is not implemented (`messageId` is optional metadata).
- [x] Source identity and ownership are validated on every query.
- [x] Confidence and evidence strength are separate fields/concepts.
- [~] Derived knowledge keeps evidence links when produced by consolidation; not every derived field is individually citeable.
- [x] Consolidation does not destroy original evidence rows.
- [x] Unsupported inferences are labelled `inferred` with lower confidence.

### C. Temporal Memory

- [x] Record observation time (`evidence.observedAt`) separately from ingestion time (`createdAt`).
- [x] Schema supports valid-time intervals (`validFrom` / `validUntil`), persisted and indexed by queries.
- [~] Interval population is not automatic; only correction/supersession and deletion set validity.
- [x] Historical versions are preserved in `memory_revisions` instead of being overwritten.
- [~] Current vs. outdated facts distinguished via status + validity; future intentions are not a distinct type.
- [~] Temporal conflicts are handled by the conflict classifier for numeric/date changes; full temporal reasoning is not implemented.

### D. Memory Evolution & Learning

- [x] New knowledge updates existing knowledge only through controlled consolidation/evolve.
- [x] Evolution is evidence-driven (conflict classifier + explicit correction).
- [x] Decisions record a reason and revision row.
- [x] Memory changes are auditable (`memory_audit`, `memory_revisions`).
- [x] Rejected/low-confidence hypotheses do not silently become facts.
- [x] Corrections preserve history (status `superseded`, revision row, old content kept).
- [x] Learning and retrieval remain separate operations (recall is read-only).
- [x] Evolution runs inside ownership/permission-aware service calls.

### E. Associative Relationships

- [x] Relationships have explicit semantic types (`supports`, `contradicts`, `supersedes`, `causes`, …).
- [x] Relationship creation validates endpoints, ownership, weight/confidence and self-links.
- [x] Support, contradiction, temporal succession and similarity are distinct relations.
- [x] Edge confidence/weight are retained.
- [x] Graph traversal is owner-scoped.
- [x] Corruption (degrees, dangling edges) can be detected and repaired.

### F. Retrieval & Evaluation

- [x] Retrieval supports semantic and structured queries (type/status/owner filters).
- [x] Ranking is measured against a retrieval benchmark (Precision/Recall/MRR).
- [x] Precision and recall are reported per configuration and category.
- [~] Conflicting/outdated memories are handled (filtered by status; conflicts preserved) but conflict-aware ranking is not a separate signal.
- [x] Retrieval preserves source attribution in returned nodes.
- [x] Retrieval does not mutate persistent memory.
- [~] Hybrid retrieval remains the default because it ties/beats keyword+entity on the local corpus and beats vector-only; the corpus is synthetic, so this is regression evidence, not research-grade proof.
- [x] Latency and scan cost are measured per query.

## P3 — Verification & Regression

- [x] `scripts/hardening-test.ts` regression suite — 82 checks across identity, permissions, secrets, extraction, conflicts, deletion, bulk preview, read-only recall, degree/dangling-edge repair, noise/truncation, transactions, portability, retention, jobs, prompt-injection fencing.
- [x] Benchmark scoring fixed (empty-expect auto-pass removed; negatives scored by false positives; no-answer accuracy reported).
- [x] All implementation suites wired into `test:all` (AGI, Dreamer, Formula, Capture, Evolution, Hardening, retrieval benchmark); universal suite via `test:universal`.
- [x] Typecheck green for `@workspace/memory`, `@workspace/agents`, `@workspace/server`.
- [x] Integration tests cover ingestion → validation → consolidation → storage → retrieval lifecycle.
- [x] Regression tests cover supersession and historical preservation (`scripts/evolve-test.ts`).
- [~] Provenance propagation is covered for extraction and deletion; not every consolidation path asserts evidence carry-forward.
- [~] Ownership isolation is covered for recall/tools; a dedicated graph-traversal authorization test is not separate from recall.
- [x] Regression tests cover failed transactions and savepoint rollback.
- [ ] Concurrency test (two writers on one SQLite DB) — SQLite serialises writes in this single-process design, but no explicit concurrent-timestamp test exists.
- [x] Regression tests cover deletion across all associated storage.
- [x] Final evidence report produced (chat report; this file is the durable record).

## P4 — Architectural Readiness

This phase evaluates whether PAME is a reliable foundation for more advanced NIMO learning and reasoning systems. It does not claim AGI readiness.

- [x] Memory interfaces are independent of specific LLM providers.
- [x] Memory operations can be consumed by multiple NIMO agents (server + agents package).
- [x] Memory governance is independent of the reasoning model.
- [x] Learning systems propose updates through validated service/tool entry points.
- [x] Reasoning systems can retrieve evidence and relationships, not only isolated text.
- [~] Memory can represent uncertainty and competing hypotheses (`confidence`, `inferred`, `contradicts`, `hypothesis` nodes); unresolved questions are not first-class.
- [~] Long-running evolution is observable via jobs/audit/revisions; no dashboard or external queue.
- [~] Resource usage is measured locally (ms/query, scan counts), not against a production deployment.
- [x] Architectural boundaries and supported capabilities are documented (`nimo/agent.md` §8a).
- [x] Final architecture review completed as part of this remediation.

## Evidence Log

**Baseline (historical, not proof of the hardened build):**

- TypeScript: clean.
- AGI: 149/149. Dreamer: 28/28. Formula: 23/23. Capture: 7/7.
- Universal: 57/60. Retrieval: vector-only MRR 0.863 vs hybrid 0.667.

**Final verification (2026-11-12, isolated temp DBs):**

- `pnpm --filter @workspace/memory run test:all` → exit 0
  - AGI 154/154
  - Dreamer 28/28
  - Formula 23/23
  - Capture 7/7
  - Evolution 20/20
  - Hardening 82/82
  - Retrieval benchmark: vector-only Recall 88.9% / MRR 0.747; vector+keyword+entity 100% / 1.000; hybrid+graph 100% / 1.000 (18 questions, 2 negative)
- `pnpm --filter @workspace/memory run test:universal` → exit 0, 100% pass over 62 questions / 6 axes
  (memory 12, research 10, coding 10, robotics 10, adaptation 10, forgetting 10; no-answer accuracy 100%).
- Typecheck: memory, agents, server → exit 0.

**Limitations of this evidence:** synthetic corpora authored alongside the system; not blind.
Hashed n-gram embeddings only; no dense model, reranker, GPU or vector DB. Conflict detection
is heuristic. No authentication is implemented by PAME itself: it consumes host-provided identity
and defaults to a deliberate single-user `local` owner unless `PAME_MULTI_USER=true`.

**Completion rule:** No phase is complete solely because its code has been written. Completion requires passing tests, inspected implementation, and recorded evidence.

**Overall objective:** Build a reliable, persistent, associative, evidence-aware memory engine that can support NIMO's future learning, reasoning, and autonomous agent capabilities without compromising integrity, ownership, safety, or historical knowledge.
