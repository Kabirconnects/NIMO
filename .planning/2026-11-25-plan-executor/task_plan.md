# Task Plan — Plan Executor (drive checklists to completion with a worker team)

**Goal:** Build a repeatable harness that takes a markdown checklist (e.g.
`packages/memory/IMPLEMENTATION-CHECKLIST.md`), drives every open item to done with
isolated worker agents, and mechanically enforces "no leftovers": implementation +
tests + independent review + recorded evidence, with the orchestrator (not the
worker) as the only writer of shared files.

**Date:** 2026-11-25
**Plan ID:** `2026-11-25-plan-executor`

## Phases

### Phase 1 — Recon: tooling, primitives, target plan
**Status:** complete

- `hc` (herdr-core CLI) is on PATH: `run`, `send`, `wait`, `read`, `ls`, `get`,
  `events`, `keys`, `kill`, `rm`. This is the agent-facing orchestration API.
- `hc send --if idle --wait --timeout N` = deterministic "deliver prompt, wait for
  the turn to end" (no sleeps).
- `hc wait --children all` = wait until no child agent is working.
- `hc events` = live fact stream (JSON lines) for a daemon.
- Workers spawned with `hc run` are recorded as `parent` children, so herdr shows
  them as sub-agents of the caller.
- Target plan: `packages/memory/IMPLEMENTATION-CHECKLIST.md` — mostly `[x]`, several
  `[~]` partial items, one `[ ]` open item (P3 concurrency test, line 169).
- Checklist's own rule (line 215): completion requires passing tests, inspected
  implementation, and recorded evidence — not just written code.
- Repo gates available: `pnpm --filter @workspace/memory run typecheck|lint|test:all`,
  turbo tasks at root.

### Phase 2 — Accuracy calibration: what makes workers trustworthy
**Status:** complete

- Broad brief ("find bugs, be thorough, 6 findings") → 14 real / 4 fabricated across
  3 workers. Fabricated examples: "any user can set role=admin" (handler was an
  empty `// TODO` stub), "listUsers exposes all users" (stub), "web-fetch XSS"
  (text goes to the model, not a renderer), "read-file 2MB causes OOM".
- Narrow brief (≤8 named files, ≤4 findings, "quote the exact line you rely on;
  omit anything you cannot prove") → **4/4 real, zero noise**, 2 minutes vs a
  13-minute hang on the broad brief.
- Conclusion: narrow scope + proof obligation + a file cap is the contract. The
  harness must encode that contract, not just dispatch a prompt.

### Phase 3 — Design the gate (what "done" means mechanically)
**Status:** complete

Worker output is never trusted. Orchestrator-side gates per item:

| Gate | Check | Failure action |
|---|---|---|
| G0 baseline | only NEW test failures block; pre-existing failures are baselined | report as a note, not a failure |
| G1 scope | changed files (including untracked ones) stay inside the item's package; the checklist is never edited by a worker; file count is bounded | reject, ask worker to narrow |
| G2 no leftovers | added lines contain no TODO/FIXME/XXX/HACK/not implemented/@ts-ignore/stub | reject, ask worker to finish |
| G3 tests exist | source changed ⇒ a test/script file changed too | reject, ask worker to add tests |
| G4 commands green | typecheck + lint + package tests run by the orchestrator in the worktree | reject, ask worker to fix |
| G5 proof | source changed ⇒ the new tests must FAIL against the pre-change source | reject: "the tests pass without the change, so they prove nothing" |
| G6 review | independent worker reviews the diff → `VERDICT: PASS` | reject with review notes |
| G7 evidence | orchestrator flips the checkbox and writes the Evidence Log entry itself | orchestrator-only write (no merge conflicts) |

- Shared-file rule: workers never edit the checklist or the evidence log. The
  orchestrator is the single writer, so item branches never conflict on those files.
- Isolation: one git worktree + branch per item (`plan/<item-id>`).
- Merge: rebase onto base → re-run gates → `git merge --ff-only`. Conflict or
  failed gate after rebase ⇒ item marked blocked, branch and worktree kept for
  inspection, nothing half-merged.
- G5 exists because the independent reviewer passed a test whose assertion was true
  by construction (`findings.md` §11). Model review is a second opinion, not a proof;
  the mechanical gates are the proof.

### Phase 4 — Build the executor
**Status:** complete

Deliverables:

- `tools/plan-executor/plan-executor.mjs` — dependency-free Node ESM orchestrator.
- `tools/plan-executor/briefs/implement.md` — worker brief (scope + proof contract).
- `tools/plan-executor/briefs/fix.md` — retry brief, carries the exact gate failures.
- `tools/plan-executor/briefs/review.md` — independent reviewer brief.
- `tools/plan-executor/README.md` — usage + how to add a plan.

Commands:

```
node tools/plan-executor/plan-executor.mjs --checklist packages/memory/IMPLEMENTATION-CHECKLIST.md \
  --base main --workers 2 --attempts 3 [--only <item-id>] [--dry-run]
```

### Phase 5 — Demo on one real item
**Status:** complete

`p3-verification-regression-10` went through the whole pipeline: implementer →
mechanical gates → independent reviewer (PASS) → rebase → re-gate → merge → checkbox
flipped → evidence written. Merged in `110615f`, checklist in `a610189`, verified
independently (16/16 in the new suite, whole memory package green).

Twelve harness bugs were found and fixed on the way; see `findings.md` §10.

### Phase 6 — Validate on a source-changing item
**Status:** in_progress

`c-temporal-memory-03` ("Interval population is not automatic") needs real source
changes, so it is the case that exercises the new G5 proof gate — the gate that
catches a test which passes with and without the change.

### Phase 7 — Hand over + run the rest
**Status:** pending

Document usage, report remaining open items (14 partial), and turn the 8 verified
review defects from Phase 1 into an executable checklist of their own.

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| Worker `t1g` hung 13 min in `Forming…` (5 min thinking, 1.7k tokens) after a Claude Code billing modal | 1 | `hc keys t1g esc`, re-brief with ≤8 files / ≤4 findings / proof obligation. Finished in ~2 min. |
| `hc send t1d` failed: terminal had already exited | 1 | Spawned replacement worker `t1j` and briefed that instead. |
| `hc send` on a blocked terminal silently queues | 1 | Use `hc send --if idle`; check status first; auto-dismiss known modal with `hc keys <t> enter`. |
| `~/.config/herdr-core/config.toml` absent ⇒ `hc templates` empty | 1 | Don't rely on templates; use `hc run --bg <agent>` + `hc send`. |
| pnpm 11 `ERR_PNPM_IGNORED_BUILDS` on every fresh worktree | 5 | `better-sqlite3: false` in `allowBuilds` (explicit skip; the package ships a prebuild). The first attempt (`true`) was worse — it ran a native build that fails without a toolchain. |
| Item blocked for scope violations it never committed | 3 | reused worktrees are rebased onto the current base before the diff is taken |
| Reviewer reported "NO VERDICT" | 4 | the prompt was sent while the agent was still booting; wait for the TUI status line |
| Reviewer verdict parsed as "E" | 4 | the report parser returned the whole match instead of the capture group |

## Decisions Made

1. Orchestrator is the single writer of the checklist and evidence log; workers only
   touch code and tests inside their own worktree. Kills cross-branch merge conflicts.
2. Every worker brief carries: exact file list, proof obligation, no-leftover rule,
   machine-readable trailer, and an explicit "say blocked rather than fake done".
3. Gates run in the worktree before merge and again after rebase.
4. Review is a separate worker from implementation; same worker reviewing itself is
   not allowed.
5. One item at a time for merge, but implementations may run concurrently.
6. A partial item stays `[~]`. The worker declares `ITEM_STATE: complete|partial`; a
   partial item keeps its checkbox, gains the exact remaining gap, and the Evidence
   Log says so. The orchestrator never ticks a partial item off.
7. The checklist's wording is the spec. "documentation only" means documentation only.

## Next Step

Validate the proof gate on `c-temporal-memory-03`, then hand over the harness and
report the remaining plan.
