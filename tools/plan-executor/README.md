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
| scope | changed files stay inside the item's package; the checklist is never edited by a worker; file count is bounded |
| leftovers | no `TODO`, `FIXME`, `XXX`, `HACK`, `not implemented`, `unimplemented`, `@ts-ignore`, `@ts-expect-error`, `stub` on added lines |
| tests | a source change without a test change is rejected |
| commands | typecheck + lint + the package test suite run **by the orchestrator** in the worktree |
| baseline | pre-existing failures are baselined, so only **new** failures block an item |
| review | a second, independent agent reviews the diff and must answer `VERDICT: PASS` |

A failed gate sends the exact failures back to the same implementer for another
attempt. After `--attempts` failures the item is marked blocked, its worktree is kept
for inspection, and nothing is merged.

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
| `--workers <n>` | items implemented in parallel (default 2) |
| `--attempts <n>` | implement attempts per item before giving up (default 3) |
| `--only <id,id>` | run only these item ids |
| `--max-items <n>` | stop after n items |
| `--gates "<cmd;cmd>"` | override the gate commands |
| `--turn-timeout <sec>` | max wait per agent turn (default 1800) |
| `--record-baseline` | record currently-failing tests and exit |
| `--open-only` | only `[ ]` items, skip `[~]` partial ones |
| `--drop-blocked` | delete blocked items' worktrees instead of keeping them |
| `--dry-run` | parse and print, change nothing |
| `--parent <t>` | herdr terminal to parent the workers to (default: auto) |

## Item ids

Ids are derived from the checklist section and position, e.g.
`p3-verification-regression-10`, `b-provenance-evidence-02`. They are stable as long as
the checklist's section headings and item order do not change. `--dry-run` prints the
full mapping.

## State

```
.planning/plan-executor/<plan-id>/
  baseline.json   failing tests at baseline, per gate command
  state.json      per-item status, worktree, branch, failures
  ledger.jsonl    append-only event log
```

## Requirements

- node >= 20
- git
- pnpm
- herdr's `hc` on PATH (`herdr-core`)

## Adding a checklist

Any markdown file with `- [ ]` / `- [~]` / `- [x]` items and a `## Evidence Log`
heading works. The package is inferred from the checklist's directory, so a checklist
at `packages/foo/PLAN.md` uses `@workspace/foo`'s gates.

## Known limits

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
