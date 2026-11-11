# PAME Hardening — Implementation Checklist

**Status:** In progress  
**Purpose:** Durable implementation, remediation, and verification record for PAME (Persistent Associative Memory Engine).

Every unchecked item represents remaining work. A task may only be marked complete when its implementation has been inspected and its acceptance criteria have passed automated tests.

---

## Phase 0 — Baseline

- [x] `git status`, `git diff` inspected (4 modified files + 1 untracked test preserved).
- [x] Baseline typecheck + existing suites recorded.
- [x] Confirmed defects reproduced in isolated temporary databases.

## P0 — Governance & Integrity

- [x] P0.1 Owner context + mode permissions (`src/runtime/context.ts`, tools, agent loop, server).
- [ ] P0.2 Real deletion + safe bulk deletion (`governance/forget.ts`, `storage/db.ts`).
- [ ] P0.3 Secret policy on every write path (`governance/policy.ts`, `ingestion/*`, `service.ts`).
- [ ] P0.4 Contradiction vs similarity classifier + retention (`graph/conflict.ts`, `ingestion/consolidate.ts`).
- [ ] P0.5 Read-only recall (remove retrieval-time reinforcement).
- [ ] P0.6 Transactions for multi-table operations.

### P0 Acceptance Requirements

- [ ] Ownership is derived from trusted server-side context, never model-generated identity.
- [ ] Deletion removes or invalidates all associated memory data, including graph relationships and embeddings.
- [ ] Bulk deletion cannot cross ownership boundaries.
- [ ] Secret detection applies to every memory write and update path.
- [ ] Similarity alone never establishes logical contradiction.
- [ ] Conflicting memories preserve historical evidence and provenance.
- [ ] Retrieval does not silently modify memory confidence, importance, or reinforcement.
- [ ] Multi-table operations cannot leave partially committed state.

## P1 — Memory Engine Correctness

- [ ] P1.1 Graph degree integrity + repair.
- [ ] P1.2 Ranking redesign (no dead PageRank term), noise threshold, truncation reporting.
- [ ] P1.3 Evolution correctness + integration.
- [ ] P1.4 Extraction speech-act/source filtering.
- [ ] P1.5 Evidence-aware confidence.

### P1 Acceptance Requirements

- [ ] Graph relationships maintain consistent references and degree counts.
- [ ] Graph repair detects and fixes corrupted or orphaned relationships.
- [ ] Retrieval ranking uses measurable, meaningful signals.
- [ ] PageRank or other ranking signals must have demonstrated measurable value before inclusion.
- [ ] Retrieval reports when results are truncated.
- [ ] Low-quality or irrelevant memories are filtered without silently discarding useful evidence.
- [ ] Memory evolution preserves historical revisions.
- [ ] Evolution changes are auditable and reversible where applicable.
- [ ] Extraction distinguishes facts, opinions, hypotheses, intentions, questions, and instructions.
- [ ] Source attribution is preserved during extraction.
- [ ] Confidence is based on evidence quality, provenance, consistency, and corroboration.
- [ ] Repeated retrieval does not increase confidence.
- [ ] Uncertainty is preserved instead of being converted into certainty.

## Agent Safety

- [ ] Mode permissions enforced inside tool execution, not just agent-loop prompts.
- [ ] Destructive operations require explicit server-side confirmation.
- [ ] Retrieved memory is fenced and treated as untrusted data.
- [ ] Model cannot set owner identity.
- [ ] Memory tools enforce ownership independently of LLM decisions.
- [ ] Tool execution validates permissions at the point of execution.
- [ ] Retrieved instructions cannot override system policies or tool permissions.
- [ ] Unauthorized agents cannot access another owner's memory.
- [ ] Failed authorization attempts are handled without leaking protected information.

## P2 — Operations & Infrastructure

- [ ] Real job handlers + retry/backoff (or honest removal).
- [ ] Retention/maintenance.
- [ ] Portable DB paths + override.
- [ ] Persistent embeddings (SQLite).
- [ ] Docs capability labels corrected.

### P2 Acceptance Requirements

- [ ] Background jobs execute actual work rather than merely reporting successful scheduling.
- [ ] Retry logic handles transient failures without duplicate destructive operations.
- [ ] Retention policies preserve required evidence and respect deletion requirements.
- [ ] Maintenance operations are safe, observable, and recoverable.
- [ ] Database paths are configurable and portable.
- [ ] Embeddings survive application restarts.
- [ ] Embedding records remain consistent with their associated memories.
- [ ] Documentation distinguishes implemented, experimental, planned, and unsupported capabilities.

## P2.5 — Memory Architecture Requirements

These are architectural requirements, not permission to introduce unnecessary complexity. Implement them using the existing PAME architecture wherever possible.

### A. Memory Classification

- [ ] Episodic memory: records experiences and events.
- [ ] Semantic memory: stores knowledge, concepts, and facts.
- [ ] Procedural memory: represents learned procedures and methods.
- [ ] Preference memory: stores explicitly supported preferences.
- [ ] Working memory: supports temporary, task-specific context.
- [ ] Associative memory: represents relationships between memories.
- [ ] Memory categories remain distinguishable without forcing every memory into only one category.

### B. Provenance & Evidence

- [ ] Important memories retain their source.
- [ ] Original evidence can be traced to its originating observation, conversation, or tool output.
- [ ] Source identity and ownership are validated.
- [ ] Confidence and evidence strength remain separate concepts.
- [ ] Derived knowledge retains links to supporting evidence.
- [ ] Consolidation does not destroy original evidence.
- [ ] Unsupported inferences are not represented as verified facts.

### C. Temporal Memory

- [ ] Record when information was observed or learned.
- [ ] Distinguish observation time from ingestion time.
- [ ] Support valid-time intervals where information changes over time.
- [ ] Preserve historical versions instead of overwriting previous truth.
- [ ] Distinguish current facts from outdated facts and future intentions.
- [ ] Resolve temporal conflicts without incorrectly treating historical changes as contradictions.

### D. Memory Evolution & Learning

- [ ] New knowledge can update existing knowledge through controlled consolidation.
- [ ] Memory evolution is evidence-driven.
- [ ] Evolution decisions retain explanations and provenance.
- [ ] Memory changes are auditable.
- [ ] Rejected hypotheses do not silently become established facts.
- [ ] The system can correct incorrect memories without destroying their history.
- [ ] Learning and retrieval remain separate operations.
- [ ] Autonomous evolution cannot bypass governance or ownership policies.

### E. Associative Relationships

- [ ] Relationships have explicit semantic types.
- [ ] Relationship creation is validated.
- [ ] Support, contradiction, temporal succession, causation, and similarity are not interchangeable.
- [ ] Relationship confidence and supporting evidence are retained where appropriate.
- [ ] Graph traversal respects ownership and access permissions.
- [ ] Graph corruption can be detected and repaired.

### F. Retrieval & Evaluation

- [ ] Retrieval supports semantic and structured queries.
- [ ] Ranking quality is measured against meaningful evaluation datasets.
- [ ] Retrieval precision and recall are measured.
- [ ] Conflicting and outdated memories are handled correctly.
- [ ] Retrieval preserves source attribution.
- [ ] Retrieval does not mutate persistent memory.
- [ ] Hybrid retrieval is only enabled as the default when benchmarks demonstrate improvement.
- [ ] Retrieval latency and resource usage are measured.

## P3 — Verification & Regression

- [ ] `scripts/hardening-test.ts` regression suite (owner, secrets, deletion, conflicts, read-only, degree, ranking, extraction, confidence, rollback, permissions, portability, retention, jobs).
- [ ] Benchmark scoring fixed (no empty-expect auto-pass; negative scoring).
- [ ] All suites wired into `test:all`.
- [ ] Typecheck and build green.
- [ ] Integration tests cover complete ingestion → validation → consolidation → storage → retrieval lifecycle.
- [ ] Regression tests cover temporal updates and historical preservation.
- [ ] Regression tests cover provenance and evidence propagation.
- [ ] Regression tests cover unauthorized graph traversal.
- [ ] Regression tests cover failed transactions and rollback.
- [ ] Regression tests cover concurrent memory updates.
- [ ] Regression tests cover deletion across all associated storage.
- [ ] Final evidence report produced.

## P4 — Architectural Readiness

This phase evaluates whether PAME is a reliable foundation for more advanced NIMO learning and reasoning systems. It does not claim AGI readiness.

- [ ] Memory interfaces are independent of specific LLM providers.
- [ ] Memory operations can be consumed by multiple NIMO agents.
- [ ] Memory governance is independent of the reasoning model.
- [ ] Learning systems can propose knowledge updates without directly bypassing PAME validation.
- [ ] Reasoning systems can retrieve evidence and relationships rather than receiving only isolated text.
- [ ] Memory can represent uncertainty, competing hypotheses, and unresolved questions.
- [ ] Long-running memory evolution is observable and recoverable.
- [ ] Resource usage is benchmarked against the actual deployment environment.
- [ ] Architectural boundaries and supported capabilities are documented.
- [ ] Final architecture review completed.

## Evidence Log

**Baseline:**

- TypeScript: clean.
- AGI: 149/149.
- Dreamer: 28/28.
- Formula: 23/23.
- Capture: 7/7.
- Universal: 57/60.
- Retrieval: vector-only MRR 0.863 vs hybrid 0.667.

**Important:** Existing baseline results are historical evidence, not proof that the hardened implementation passes. Re-run affected suites after remediation.

**Completion rule:** No phase is complete solely because its code has been written. Completion requires passing tests, inspected implementation, and recorded evidence.

**Overall objective:** Build a reliable, persistent, associative, evidence-aware memory engine that can support NIMO's future learning, reasoning, and autonomous agent capabilities without compromising integrity, ownership, safety, or historical knowledge.