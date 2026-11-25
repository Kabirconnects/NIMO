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
| `--dry-run` | print the items, the gates and the focus lines; change nothing |
| `--record-baseline` | run the gates now and record what already fails, so pre-existing failures do not block every item |
| `--open-only` | skip the `[~]` items and work only on the `[ ]` ones |

By default every open item is worked on — both `[ ]` and `[~]`. Use `--open-only`
to skip the partial ones.

`--merge-only` is the recovery path: if a merge fails (a diverged base, a
conflict) but the work itself had already passed every gate and the independent
review, this merges it without running the worker again. The gates are still
re-run after the rebase, so nothing is merged on trust.

## Self-test

```sh
node tools/plan-executor/selftest.mjs
```

The harness decides where the worker should look and what an item actually is.
Those two decisions are worth checking on their own, so they are: the
self-test covers the path resolution (a checklist that spans several packages
has no single "its" package), the checklist parsing (item ids, multi-line
items, item state), and the reading of the worker's report off the screen —
including that the brief, the item text and the terminal's own chrome cannot
be mistaken for it.

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
  adds a commit. Each item's branch is therefore cut from the tip of the base
  branch **at the moment that item starts**, and the gates diff against that
  commit — so the diff is exactly the item's work, a commit you make to `main`
  while the run is going does not turn your files into "worker changes" and
  fail the scope gate, and an item that starts after the previous one merged
  does not have to be rebased at all. Items are implemented and merged a batch
  at a time (a batch is `--workers` items), so a batch starts from the code the
  previous batch merged. Implementing everything first and merging afterwards
  meant every item was written against one commit: every item conflicted with
  every other one.
- **The brief is on the screen, and the report is read off the screen.** The
  worker is told to read the brief, and the brief contains the report format —
  so the harness found "STATUS: done" in the brief's own example, ended the
  turn while the worker was **still working**, and ran the gates against a
  worktree that was changing under them. The harness now subtracts the brief
  it wrote from the screen before reading anything out of it, and the brief's
  placeholders are inert. The item's text is on the screen too, and it is
  prose: the report's field names are matched case-sensitively, because the
  P0.7 item says a method "must return `{ changed: false }`" and a
  case-insensitive read took that for the worker's list of changed files.
- **A 503 from the model API is not the worker's fault.** An API error ends
  the turn with an error instead of a report, and the worker never got to do
  anything — the harness judged the worktree it never touched, and the item
  burned all three attempts. A turn that ends in a 503 is sent again instead.
  Only the end of the screen counts, so a 503 Claude Code recovered from by
  itself does not cut the turn short.
- **A worker that never read its output will claim it passed.** One worker ran
  the full suite, got "Error: Exit code 1" with the output collapsed to
  "… +204 lines", never saw which assertions failed, changed nothing, and
  reported "test:all exited 0". The gates caught it. The brief now tells the
  worker to run the failing script on its own — the suite's output is
  collapsed, and a failing assertion is invisible in it — and the harness
  logs the worker's claim next to the gate's verdict when they contradict
  each other.
- **A proof that cannot load is not always inconclusive.** A test that imports
  a module the old code does not have is a proof — it cannot run without the
  change. So is a test that calls a function the change *adds*: against the old
  source it dies with "`setPolicy` is not a function". The proof compares the
  exports before and after, so that case counts. What does not count is the old
  source crashing on its own (it reads `import.meta.env`, say): the test never
  ran, so it demonstrated nothing.
- **A checklist that spans several packages has no single "its" package.** A
  package-relative path (`src/lib/api-error.ts`) resolved against the first
  scoped package, so the worker was pointed at a file that was not there while
  the real one was passed over. Paths are resolved against every scoped package,
  and the item's own package wins for a file that does not exist yet — a script
  the item is going to create.
- **A worktree holds a full `node_modules`** — tens of thousands of files. Git
  removes them one by one, which takes minutes; the shell's own recursive
  delete clears the same tree in seconds. The removal tries git first, then
  deletes the directory and lets git forget it.
- **A blocked item must say why.** "Blocked" without a reason is not a record,
  it is a shrug — and the live state file is not kept in git. The reason goes
  into the ledger, which is.
- **The brief is the instruction, so the brief must be right.** Two bugs made it
  wrong: item-named paths were joined onto the checklist's package root (so the
  worker was told to edit `…\apps\server\apps\server`, which does not exist),
  and a multi-line checklist item was cut at its first line (so the worker *and*
  the reviewer both received "…currently have **no automated"). The reviewer only
  adds independence over the work, never over the instruction — if both halves
  read a broken instruction, they share the blind spot instead of checking each
  other.
- **Two items that touch the same file conflict when the first one merges.**
  The second was written against a base that no longer exists, so its rebase
  conflicts. That is a merge to do, not a broken item: the conflict goes to an
  agent whose only rule is that *both* sides' intent survives, and the resolved
  code is then re-verified — the gates, the proof against the new base, and a
  second independent review. The other item's tests are in the tree at that
  point, so a resolution that quietly dropped its behaviour fails there instead
  of in production.
- **The code that lands must be the code that was reviewed.** A rebase always
  changes the commit, and a conflict resolution changes the code. The changed
  lines are recorded at review time and compared with the changed lines after
  the rebase; if they differ, the change is proved and reviewed again before it
  merges.
- **An agent that cannot run a command writes blind.** Claude Code asks a
  classifier whether a command is safe before it runs it, and that classifier can
  be unavailable — every command comes back "Not run", the worker cannot see a
  single test fail, and it guesses wrong. The harness pre-approves the tools the
  worker needs (`--allowedTools`); if commands are refused anyway, it interrupts
  the turn and tells the worker to finish without them, instead of letting it
  retry for ten minutes. The same applies to the conflict resolver: it needs
  `git add` and `git rebase`, or it can edit the file but not finish the merge.

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

The wording follows the item. An item often states a gap ("... is not
implemented"), so when the worker closes that gap the old wording is no longer
true — and a ticked item whose text says the feature is missing is worse than an
unticked one. The worker therefore reports `ITEM_TEXT: <the item's wording after
your change>` and the orchestrator, which owns the checklist file, writes it. The
worker never edits the checklist itself.

An item that could not be completed keeps its box and gets a line in the
Evidence Log anyway, saying what failed. "We looked and could not" has to be
distinguishable from "nobody looked" — and the item's own text is the gap, so
the log line is the reason it is still open.


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

