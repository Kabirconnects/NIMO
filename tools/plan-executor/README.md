# plan-executor

Drives a markdown checklist to completion with a team of agents, and refuses to call
anything "done" until it is provably done.

Built on herdr's `hc` CLI, so every worker is a real herdr sub-agent: visible in the
Agents list, inspectable with `hc attach`, killable with `hc kill`.

## The idea

An agent's claim that it finished is not evidence. The worker never gets to decide
whether it passed. The orchestrator decides, mechanically, and an independent reviewer
agent gets the last word on judgement calls.

```
                 ┌────────────────────────── orchestrator (this script) ──────────────────────────┐
                 │                                                                                │
  checklist ───▶ │ parse items ─▶ worktree per item ─▶ brief implementer ─▶ mechanical gates     │
  (markdown)     │                                     │                     (scope, leftovers,  │
                 │                                     │                      tests, commands)    │
                 │                                     ▼                                              │
                 │                              agent implements ─▶ commit ─▶ independent reviewer  │
                 │                                                                    │             │
                 │                                                             PASS │   FAIL ──────┘
                 │                                                                    │             │
                 │                                                                    ▼             │
                 │                                            rebase ─▶ re-gate ─▶ merge ─▶ flip  │
                 │                                            checklist + write evidence            │
                 └────────────────────────────────────────────────────────────────────────────────┘
```

## Gates

| Gate | What it enforces |
|---|---|
| scope | changed files (including untracked ones) stay inside the item's package; the checklist is never edited by a worker; file count is bounded |
| leftovers | no `TODO`, `FIXME`, `XXX`, `HACK`, `not implemented`, `unimplemented`, `@ts-ignore`, `@ts-expect-error`, `stub` on added lines |
| tests | a source change without a test change is rejected |
| commands | typecheck + lint + the package test suite run **by the orchestrator** in the worktree |
| baseline | pre-existing failures are baselined, so only **new** failures block an item |
| proof | when source changed, the new tests are re-run against the pre-change source — if they still pass, they prove nothing and the item is rejected |
| review | a second, independent agent reviews the diff and must answer `VERDICT: PASS` |

A failed gate sends the exact failures back to the same implementer for another
attempt. After `--attempts` failures the item is marked blocked, its worktree is kept
for inspection, and nothing is merged.

The **proof** gate exists because the reviewer is a model, not a proof: in the first
demo an independent reviewer passed a test whose assertion was true by construction
(it ran *after* a repair function that had already fixed what it checked). The
mechanical gate catches that class of problem without judgement calls.

## Why the orchestrator owns the checklist

If every worker flipped its own checkbox, every item branch would edit the same lines
and the merges would conflict. So workers touch code and tests only; the orchestrator
writes the checkbox and the Evidence Log entry itself, using the commands it actually
ran. One writer, no conflicts, and the evidence is real because the orchestrator ran
it.

## Usage

```sh
# 1. record which tests already fail, so they don't block every item
node tools/plan-executor/plan-executor.mjs \
  --checklist packages/memory/IMPLEMENTATION-CHECKLIST.md --record-baseline

# 2. see what would run
node tools/plan-executor/plan-executor.mjs \
  --checklist packages/memory/IMPLEMENTATION-CHECKLIST.md --dry-run

# 3. run it
node tools/plan-executor/plan-executor.mjs \
  --checklist packages/memory/IMPLEMENTATION-CHECKLIST.md \
  --base main --workers 2 --attempts 3
```

### Options

| Flag | Meaning |
|---|---|
| `--checklist <path>` | the markdown checklist (required) |
| `--base <branch>` | branch to build on and merge into (default `main`) |
| `--package <name>` | pnpm workspace package (default: inferred from the checklist path) |
| `--scope <a,b>` | packages an item may touch (default: the checklist's package) |
| `--workers <n>` | items implemented in parallel (default 2) |
| `--attempts <n>` | implement attempts per item before giving up (default 3) |
| `--only <id,id>` | run only these item ids |
| `--max-items <n>` | stop after n items |
| `--gates "<cmd;cmd>"` | override the gate commands |
| `--parent <t>` | herdr terminal to parent the workers to (default: auto) |
| `--plan-id <id>` | name of the state directory (default: derived from the checklist) |
| `--merge-only` | merge items that already passed every gate and the reviewer, without spawning a worker (recovery path) |

By default every open item is worked on — both `[ ]` and `[~]`. Use `--open-only`
to skip the partial ones.

`--merge-only` is the recovery path: if a merge fails (a diverged base, a
conflict) but the work itself had already passed every gate and the independent
review, this merges it without running the worker again. The gates are still
re-run after the rebase, so nothing is merged on trust.

## Item ids

Ids are derived from the checklist section and position, e.g.
`p3-verification-regression-10`, `b-provenance-evidence-02`. They are stable as long as
the checklist's section headings and item order do not change. `--dry-run` prints the
full mapping.

## State

```
.planning/plan-executor/<plan-id>/
  baseline.json       failing tests at baseline, per gate command
  state.json          per-item status, worktree, branch, failures
  ledger.jsonl        append-only event log
  harness-patched.json  files the harness itself patched (kept out of commits)
```

## Things that will bite you

These are not hypothetical - each one broke a real run before it was fixed.

- **The gates diff the worktree against the base branch.** A worktree left over
  from an earlier run was created against an older base commit, so every change
  the base made since then looked like the worker's work and the item was blocked
  for scope violations it never committed. Reused worktrees are now rebased onto
  the current base before anything else happens.
- **pnpm re-checks its install state before every script.** A worktree that
  cannot be installed fails every gate for a reason that has nothing to do with
  the item. The harness installs first and, if pnpm's build-script policy blocks
  a native dependency, allow-lists it in the worktree - then restores the file,
  because an environment fix is not the worker's work and must not enter the
  commit. The install is frozen by default; if the item legitimately adds a
  dependency, the lockfile is out of date and pnpm refuses - so the harness
  retries without the freeze, and records that the lockfile changed.
- **A fresh agent is not ready when `hc run` returns.** Sending the brief during
  the boot window means the prompt is dropped, and the turn looks like it
  finished instantly with no output. The harness waits for the UI to reach a
  prompt before sending.
- **Screen scraping is the weakest link.** The report trailer is read from the
  terminal, so it must be matched by regex over the visible lines. A stray
  "VERDICT:" in the agent's reasoning would be misread, so the trailer is only
  accepted in the last few lines of the screen.
- **The terminal scrolls, so the last turn's trailer is still visible.** Reading
  it as the current turn's answer makes the harness give up while the worker is
  still working — the worker is then never given the time to act on the failure
  list it was handed. Only the screen *after* the echoed prompt is read.
- **The base branch moves while the run is in progress.** Every merged item
  adds a commit. The merge phase therefore resolves the base branch's tip
  fresh; resolving the SHA captured at startup would rebase onto a stale base
  and the fast-forward merge would fail.
- **A worktree holds a full `node_modules`** — tens of thousands of files. The
  removal gets ten minutes, falls back to deleting the directory directly, and
  says so if it still cannot be removed.
- **The brief is the instruction, so the brief must be right.** Two bugs made it
  wrong: item-named paths were joined onto the checklist's package root (so the
  worker was told to edit `…\apps\server\apps\server`, which does not exist),
  and a multi-line checklist item was cut at its first line (so the worker *and*
  the reviewer both received "…currently have **no automated"). The reviewer only
  adds independence over the work, never over the instruction — if both halves
  read a broken instruction, they share the blind spot instead of checking each
  other.

## Requirements

- node >= 20
- git
- pnpm
- herdr's `hc` on PATH (`herdr-core`)

## Adding a checklist

Any markdown file with `- [ ]` / `- [~]` / `- [x]` items and a `## Evidence Log`
heading works. The package is inferred from the checklist's directory, so a checklist
at `packages/foo/PLAN.md` uses `@workspace/foo`'s gates. A checklist that spans
several packages passes `--scope packages/foo,packages/bar`, and each package in
scope contributes its own typecheck/lint/test to the gate list.

## Partial items are not ticked off

An item can be partly satisfied — the checklist's `[~]` state. The worker has to
say which: `ITEM_STATE: complete` or `ITEM_STATE: partial` plus the exact
remaining gap. A partial item stays `[~]`, the gap is appended to the item's
line, and the Evidence Log records that it is still partial. The orchestrator
never turns a partial item into a completed one.


- Items that must land in sequence (item B depends on A's API) should be run with
  `--only` in order; parallel items that touch the same file can end up conflicting at
  rebase, and a conflicting item is reported as blocked rather than silently mangled.
- The reviewer is a model, not a proof. Mechanical gates carry the real weight; the
  reviewer catches judgement issues (incomplete implementation, weak tests) that a
  regex cannot.
- A worker that reports `blocked` is retried with the same brief. If the blocker is
  genuine (needs a human decision), it will burn its attempts and end as blocked —
  which is the correct outcome, but wastes tokens. Prefer a short `--attempts` when
  the plan is known to need decisions.
- The checklist's wording is the spec. If an item says "documentation only", a
  worker that rewrites code to satisfy it has misunderstood — the reviewer is the
  last check on that.

