# Findings — Plan Executor

## 1. Herdr's agent-facing API is `hc`, not the GUI

- `hc` = `C:\Users\Himanshu Arodia\AppData\Local\Programs\herdr-core\hc.exe`.
- GUI state (`herdr-core\default\terminals.json`, `docs.json`) is bookkeeping for the
  window; it shows agents and statuses but offers no agent→agent channel.
- `hc` gives: `run` (spawn, `--bg`, `--parent`, `--name`, `--cwd`), `send`
  (`--if idle`, `--wait`, `--timeout`), `wait` (`--children all|any`, `--output`),
  `read`, `ls --json`, `get --json`, `keys`, `interrupt`, `kill`, `rm`, `events`,
  `exec`, `file read|write|edit`.
- `hc run` from inside a terminal records the caller as `parent` ⇒ the spawned agent
  becomes a herdr sub-agent, visible in the Agents list, no pane needed.
- Workers do NOT self-close. They sit at their prompt after a turn. Cleanup is the
  orchestrator's job (`hc kill` / `hc rm`).

## 2. Worker accuracy depends on brief shape, not model effort

| Brief | Result |
|---|---|
| Broad: "review this area, ≤6 findings, be thorough" | 14 real / 4 fabricated; one worker hung 13 min |
| Narrow: "read ≤8 named files, ≤4 findings, quote the exact line, omit what you cannot prove" | 4/4 real, ~2 min |

Fabricated findings are dangerous because they are confidently worded and cite real
line numbers. Any harness must verify independently — never trust the report.

## 3. Target checklist shape (`packages/memory/IMPLEMENTATION-CHECKLIST.md`)

- Legend: `[x]` done+tested · `[~]` partial with stated gaps · `[ ]` not done.
- 217 lines; sections Phase 0, P0, P1, Agent Safety, P2, P2.5 (A–F), P3, P4,
  Evidence Log.
- Open work: 1 × `[ ]` (P3 concurrency test, line 169) and ~12 × `[~]` partial items
  (P1.3, noise-gate scan cap, working-memory type, evidence traceback, derived
  evidence links, temporal interval population, validity semantics, temporal
  conflicts, provenance propagation, ownership-isolation traversal test,
  conflict-aware ranking, hybrid-retrieval caveat, resource usage).
- Its completion rule (line 215) already matches the gate design: tests + inspected
  implementation + recorded evidence.
- Package gates: `pnpm --filter @workspace/memory run typecheck | lint | test:all`
  (`test:all` = agi → dreamer → formula → capture → evolve → hardening → benchmark).

## 4. Verified real defects found by the team (independent verification, 2026-11-25)

Confirmed by reading source:

1. **Per-owner memory policy never loaded.** `DEFAULT_POLICY` hardcoded at
   `packages/memory/src/service.ts:57,116,294,400`,
   `ingestion/ingest.ts:48,68`, `workers/ingestion.worker.ts:34`, `tools.ts:252,289`;
   `governance/policy.ts:148` has an unused `_policy` parameter. The
   `memory_policies` table is never consulted ⇒ user policy settings are ignored.
2. **Unauthenticated user routes.** `apps/server/src/modules/user/users.routes.ts:16`
   (`GET /`), `:25` (`GET /:id`), `:26` (`PATCH /:id`), `:27` (`DELETE /:id`) have no
   `authMiddleware`. Handlers are `// TODO` stubs today (`users.controller.ts:14,25,
   179,188`) so nothing leaks — but they also never respond (request hangs).
3. **No login rate limiting** at `apps/server/src/modules/user/users.routes.ts:19`.
4. **Command reuse collides on joined string.** `packages/agents/src/tools/shared/
   process.ts:589` builds `commandLine = argv.join(" ")`, matched at `:697-700`, so
   `["run","a b"]` and `["run","a","b"]` are the same "process".
5. **Transient 5xx logs the user out.** `apps/web/src/features/auth/hooks/
   use-session.ts:32` (`retry: false`) + `components/protected-route.tsx:28`
   (`if (!user)`) — `isError` is never checked.
6. **Logout leaves a stale session on error.** `apps/web/src/features/auth/hooks/
   use-logout.ts:15-17` clears the cache only in `onSuccess`, no `onError`.
7. **Raw internal error text reaches the UI.** `apps/web/src/lib/api-error.ts:34-35`
   returns any `Error.message`.
8. **Prod API URL is a placeholder.** `apps/web/src/lib/api-client.ts:3-4`
   `https://api.yourdomain.com` when `VITE_API_URL` is unset (cookies are host-scoped,
   so this is a broken-prod-config bug, not a cookie leak).

## 5. Git/worktree constraints for parallel workers

- `git worktree list` shows: main repo `D:\Projects\nimo-v2.0.0\nimo` (main),
  herdr workspace `~\.herdr\worktrees\nimo\workspace` (branch `workspace`, clean),
  plus three opencode worktrees under `~\.local\share\opencode\worktree\`.
- Item branches must live outside the main checkout to avoid `git status` noise:
  use `~/.herdr/plan/<plan-id>/<item-id>` (outside the repo, registered as a worktree).
- The checklist file must be edited by the orchestrator only; if workers edited it,
  every item branch would conflict on the same lines at merge time.

## 7. The repo has a stale-test / changed-design conflict (found by the harness, needs a human decision)

`pnpm --filter @workspace/memory run test:all` **fails on `main` today**: the hardening
suite reports 80 passed / 2 failed, while the checklist's Evidence Log claims 82/82.

The two failures:

- `FAIL [PERMISSIONS] Chat cannot write memory`
- `FAIL [PERMISSIONS] Plan cannot teach/write memory`

Root cause is a half-landed design change, not a typo:

| date | commit | what it did |
|---|---|---|
| 2026-11-12 | `2c74b0c` "Implement permissions and process management for agent tools" | wrote `hardening-test.ts` asserting Chat/Plan **cannot** write; `permissionsFor` returned `{ write: mode === "Auto" }` → 82/82 green |
| 2026-11-13 | `21484b7` "feat: add manageProcessTool for controlling background processes" | changed `permissionsFor` to `{ write: true, delete: mode === "Auto" && destructiveConfirmed }` with the comment *"every mode may record memories so the brain keeps growing"* — in a commit about an unrelated feature |

The **agents** side was changed deliberately and consistently:
`packages/agents/src/core/tools/tools-mode.config.ts:2-5,56,67` gives Chat and Plan
`MEMORY_WRITE_TOOLS` ("memory still learns", "only destructive operations are gated").
So current code intent = all modes may write memory.

Left stale: the hardening test (still asserts the old rule) and the checklist
(dated 2026-11-12, claims 82/82, and its "Agent Safety" section says "Mode permissions
enforced inside tool execution").

Three ways to resolve — all defensible, different security postures:

- **A. Update the test + checklist to the current design** (all modes write). Cheapest;
  matches the code's stated intent. But then untrusted chat input can seed durable
  memories → prompt-injection → memory-poisoning is possible *by design*, and nothing
  gates writes (only deletes are gated by `confirmation_required`).
- **B. Restore mode-gated writes** (`write: mode === "Auto"`). Matches the checklist's
  Agent Safety wording and the original test; closes the poisoning vector; requires
  changing `tools-mode.config.ts` too, and loses chat-driven learning.
- **C. Hybrid:** Chat may write only ephemeral/inferred memories (retention `ephemeral`,
  lower confidence, never promoted), durable writes need Auto. Also closes the vector
  while keeping some learning; more work.

**This needs the user's call** — it changes product behaviour, not just code.

## 8. pnpm 11 build-script policy breaks fresh worktrees (and fresh clones)

`pnpm-workspace.yaml` `allowBuilds` listed `esbuild`, `sharp`, `unrs-resolver`, `bcrypt`
but **not `better-sqlite3`**, which `packages/memory` depends on. On a fresh install pnpm
11 refuses the build script and exits 1 with `ERR_PNPM_IGNORED_BUILDS`, appending a
placeholder line `better-sqlite3: set this to true or false` to `pnpm-workspace.yaml`.

- The main repo only installs clean because its `node_modules` already exists — nothing
  needs rebuilding, so the policy never triggers. A fresh clone would fail.
- `better-sqlite3@13` ships its prebuilt native binary inside the package
  (`prebuilds/`), so no build is actually required — the policy is pure friction.
- Fix applied: `better-sqlite3: true` added to `allowBuilds` in `pnpm-workspace.yaml`
  (a real repo fix, not just a harness workaround).
- Harness fix: `installDeps()` self-heals — if the install is blocked by the policy, it
  allow-lists the ignored packages in the *worktree's* `pnpm-workspace.yaml`, retries,
  then restores the tracked file so the item's diff stays clean.

## 9. Harness design decisions taken while building

- **Baseline-aware gates.** The first demo run would have blamed every worker for the 2
  pre-existing failures. The executor now records a baseline
  (`.planning/plan-executor/<plan-id>/baseline.json`) of failing test names per gate
  command. A gate fails only on **new** failures; baselined ones are reported as notes.
- **Install self-heal** (see §8) — a failed install blocks the item with the real error
  instead of a generic "install failed".
- **Scope gate allows a small root-config whitelist** (`pnpm-workspace.yaml`,
  `package.json`, `pnpm-lock.yaml`, `turbo.json`, `tsconfig.json`, `.npmrc`) because
  some items legitimately need shared config; those changes are flagged in the notes so
  the reviewer must justify them.
- **Item ids** are `<section-slug>-<position>` (e.g. `p3-verification-regression-10`),
  stable while section headings and item order hold. `hc` agent names are truncated to
  32 chars (`hc run --name` limit).
- **Worker briefs carry the calibration lesson**: exact scope, "quote the exact line or
  omit the finding", no-leftover list, machine-readable trailer, and "say blocked rather
  than fake done". The same brief shape produced 4/4 verifiable findings where the
  loose brief produced 4 fabricated ones.

## 10. The harness's own bugs — found only by running it

Every one of these was a real failure, not a hypothetical. They are the reason the
demo took five runs instead of one.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | item blocked, "pnpm install failed" | pnpm 11 refuses unlisted build scripts | `installDeps()` self-heals |
| 2 | crash: `matchAll called with a non-global RegExp` | report regexes lacked `/g` | added `g` |
| 3 | stray worker files invisible to the gates | `git diff` does not see untracked files | gates also read `git ls-files --others` and scan their content |
| 4 | `name_taken` crash on rerun | previous run's agent still live | `spawnAgent()` reclaims the name, falls back to a unique name |
| 5 | item restarted from zero after a crash | worktree recreated | `makeWorktree()` reuses an existing worktree |
| 6 | **item blocked for scope violations it never committed** | the worktree was created against an older base, so `git diff base` showed every change the *base branch* made since then | reused worktrees are rebased onto the current base before anything else |
| 7 | every gate failed with a pnpm stack trace | the install self-heal restored the file, and pnpm re-checks its install state before every script | the patched file is kept during the run and restored only before committing |
| 8 | rebase conflict on `pnpm-workspace.yaml` | the self-heal rewrote the file with LF endings → whole-file diff | surgical edit that preserves line endings |
| 9 | **reviewer returned "NO VERDICT"** | the prompt was sent while the agent was still booting | `waitForAgentReady()` waits for the TUI status line before sending |
| 10 | **reviewer verdict parsed as "E"** | `last()` returned the whole regex match, so `?.[1]` indexed into the string `"VERDICT: PASS"` | the helper returns the capture group |
| 11 | a turn "finished" instantly with no output | an agent looks idle for a moment before it starts | the report trailer is the completion signal; an idle agent only ends the turn once it has been working |
| 12 | review failed even when the reviewer was right | all of the above | fixed together; the demo then passed review and merged |
| 13 | **the worker never saw the failures it was handed** | the terminal scrolls, so the *previous* turn's `STATUS: done` trailer was still on screen when the next prompt was sent; the harness matched it, thought the new turn was over, and ran the gates while the worker was still working | only the screen after the echoed prompt is read, so a trailer from an earlier turn can never be mistaken for this turn's answer |
| 14 | **the merge never happened** | the merge phase resolved the base **SHA captured at startup**, so `git rebase <base>` was a no-op; every item that merged during the run moved the base branch, so by merge time the branch and the item had diverged and the fast-forward merge failed | the base **branch** is resolved fresh at merge time, the merge refuses to run unless HEAD is on that branch, and a base that moves mid-merge is retried |
| 15 | **the worker was told to edit directories that do not exist** | paths named in the item text (`apps/server`) were joined onto the checklist's *package* root, so the brief said `Change files only inside: ...\nimo\apps\server\apps\server` | item-named paths are resolved against the repo (package-relative ones get the package prefix) and kept only if they exist; the brief's scope list is now the scope the gate enforces |
| 16 | **the worker and the reviewer both got half an item** | the parser read only the first line of a checklist item; a multi-line item reached the worker as a sentence cut in half ("...currently have **no automated") — and the reviewer judged the same fragment, so a half-understood task could pass | continuation lines are joined into the item text; the first line is kept separately for finding the item in the file |
| 17 | **an item that adds a dependency can never pass** | the worktree install was always `pnpm install --frozen-lockfile`; adding a package makes the lockfile out of date, so every gate failed before it ran ("ERR_PNPM_OUTDATED_LOCKFILE"), and the worker was told to fix a command failure it did not cause | the install retries without the freeze for that one error, and the lockfile change is recorded as a note and appears in the review diff |
| 18 | **the proof gate proved the wrong package** | it always ran the *first* test command in the gate list, which is the plan's own package; S4 changed `packages/agents`, but the proof ran the **server's** suite, which never imports the agents package - so the old code passed and the worker was told its agents test was tautological (it was, but for a reason the message hid) | the proof now resolves each changed source file to its package and runs that package's test command; if no gate command covers it, the item fails with that as the reason, and the failure message now includes the output of the proof run |
| 19 | **a worker that asks for approval produces nothing at all** | Claude Code interrupted the turn with its plan-approval prompt ("Claude has written up a plan and is ready to execute"); the worker sat there until the attempt timed out, the worktree stayed empty, and the item failed the diff gate three times with no hint that a modal was waiting | the harness looks for a modal on every poll (not only when the agent reports "blocked") and answers it - the plan prompt with enter, which takes "Yes, and use auto mode" - and the briefs tell the worker not to stop for approval |
| 20 | **a proof that had already succeeded was reported as inconclusive** | `collectFailures` only understood the memory suite's `FAIL <name>` lines; the test scripts S0 introduced print `<cross mark> <name>`, so a real test failure looked like "the command died without naming a failure" | the collector understands every convention the repo's suites use (`FAIL`, `✗`, `✘`, `✕`, `❌`, TAP's `not ok`) |
| 21 | **a worker that looked in the wrong directory stalled on a permission prompt** | the worker tried to read a file under a worktree directory it had invented (the name appears nowhere in the repo or the brief), hit "Allow this read outside the working directories?", and waited - a prompt the harness did not recognise | permission prompts are recognised and answered, and both briefs state that every path is relative to the worktree root and that guessing a directory name is not allowed |
| 22 | **an item whose fix adds a file could never be proved** | the proof restored the old source with one `git checkout base -- <paths>`, which fails outright when the fix *created* a file - so nothing was restored, the new code was tested against itself, and the proof failed; and a test that imports the new module was called "inconclusive" even though not loading without the change is itself proof | the old source is restored file by file (a created file is removed), and a test that cannot load without the change counts as a proof - it pins the new code. A test that fails to load because the *old* source crashes is still inconclusive |
| 23 | **no route test could even start** | the server validates its environment at import time, and the values live in `.env` - which is gitignored, so a fresh worktree has none. Every server route test died with "Invalid environment configuration" before it ran a single assertion, and `.env.example` was itself incomplete (no `AI_MODEL`, so copying it did not help either) | the worktree is seeded with the committed example files (gitignored, so they never enter a commit), the example file now satisfies the app's own env schema, and the item text requires the test script to provide the values itself so it also works outside the harness |
| 24 | **the workers were writing blind** | Claude Code asks a classifier whether a command is safe before it runs it, and that classifier is unavailable on this machine: every command came back "Not run - auto mode's check had no usable answer". The worker could not run a single test, so it guessed - and its guesses were wrong (it wrote assertions that could not pass, because it could not see them fail). One worker spent ten minutes asking for the same command again | the harness pre-approves the tools the worker needs (`--allowedTools`), so the repo's own pnpm scripts run without a classifier; and if commands are refused anyway, the harness interrupts the turn and tells the worker to finish without them |

Bugs 15 and 16 are the same class, and the most dangerous one: **the brief lied.**
Nothing in the output said the instruction was wrong. The worker was told to
change files inside four nonexistent directories, and told the item was
"`apps/server`, `apps/web` and `packages/agents` currently have **no automated".
It would have failed — or worse, "succeeded" at something else.

Bug 16 is the one that could have silently corrupted a result. The reviewer is
meant to be the independent check on the worker, but it reads the *same*
`ITEM_TEXT`. If the item text is truncated, worker and reviewer are judging the
same fragment, and the review gate agrees with itself rather than with the
plan. A pipeline whose two halves share a blind spot is one half.

Both were found the same way: by reading the brief the worker actually received,
rather than the brief the code was supposed to produce.

Bug 13 is the one that mattered. Its symptom was subtle: the retries simply came
back too fast (1m39s and 52s for attempts that needed minutes), and the identical
error survived all three attempts. The worker was being asked to fix a type error
and was never actually given the time to read the failure list. Nothing in the
output said "the worker was ignored" — the harness looked like it was working
exactly as designed.

It was found by reading the **timings** in the ledger rather than the output: two
attempts under two minutes on a 447-line test file is not plausible, and that
inconsistency was the only signal.

Bug 14 was found the same way — by reading the reflog instead of the output:

```
ec6edfb HEAD@{0}: commit: plan(c-temporal-memory-03): ...
f34a8d9 HEAD@{1}: reset: moving to f34a8d9
ab4c0d7 HEAD@{2}: rebase (finish): returning to refs/heads/plan/c-temporal-memory-03
```

There is no rebase *after* the commit, so the merge-time rebase never happened in
the worktree. The cause was one line: `ctx.base` held a SHA, and
`git rev-parse <that sha>` returns that same sha — the comment said "rebase onto
the current base", but the code resolved the base from *startup*. The first demo
passed only because nothing had moved the base branch during that run.

Both bugs share a shape worth naming: **the harness remembered what was true when
it started, instead of asking what is true now.** A stale fact that looks correct
is worse than no fact, because nothing looks wrong.

The lesson generalises: **a harness that is never run is a hypothesis.** Five of these
bugs were invisible to reading the code and obvious only when an agent actually used it.

## 11. The reviewer is not a proof — and the demo proved it
The merged concurrency test called `repairGraphDegrees()` *before* asserting that
`graph_degree` matched the edge table. The assertion was therefore true by
construction: it could not detect a broken concurrent write. The independent reviewer
returned `VERDICT: PASS`.

Two things followed from that, and both are now in the harness:

1. **A mechanical proof gate (G7).** When an item changes source, the worker's tests
   are re-run against the pre-change source. If they still pass, they prove nothing and
   the item is rejected. Verified mechanically: a no-op source change leaves the suite
   green → the gate fires; the worker's source is restored byte-for-byte (identical
   SHA256 after the check).
2. **The review brief now asks the question that was missed**: "watch for assertions
   that are true by construction — a check that runs *after* a repair, migration, seed
   or fixup step proves nothing about the thing it checks."

The tautological assertion was fixed by hand (the check now runs against the
un-repaired state, and the repair pass is verified separately; the pre-repair state is
in fact consistent, 0 mismatches, so the incremental `graph_degree` maintenance in
`insertEdge` does hold under interleaved writes).

**The division of labour is the point:** mechanical gates carry the weight; the model
reviewer catches judgement issues and *sometimes* misses real ones. A harness that
relies on the reviewer alone is exactly the "trust the worker" design this was built
to replace.

## 12. `better-sqlite3: true` was the wrong fix — `false` is right

The first fix for pnpm's `ERR_PNPM_IGNORED_BUILDS` was to add `better-sqlite3: true`
to `allowBuilds`. That is **worse than the original problem**: it makes pnpm actually
run the native build, which needs a local toolchain and fails with a gyp error — so a
fresh install still fails, now with a native build error instead of the policy error.

The correct form is the explicit skip, which the repo already used for `msw`
(`msw: false`): `better-sqlite3: false`. better-sqlite3 ships a prebuilt binary, so
its build script is not needed at all.

Verified in a scratch worktree with `node_modules` deleted:

```
pnpm install --frozen-lockfile  -> exit 0
require('better-sqlite3')       -> sqlite OK -> { a: 7 }
```

The harness's own self-heal was changed to match: try the build first, and if the
build itself fails, fall back to skipping it.

## 13. The typecheck gate never checked the tests — a broken test only failed at runtime

`packages/memory/tsconfig.json` had `"include": ["src/**/*.ts"]`, and every test in
that package lives in `scripts/`. So `pnpm run typecheck` never looked at a single
test file.

This is not theoretical. The worker on `c-temporal-memory-03` wrote a test that calls
`memoryService.remember()` without the required `type` field:

```ts
// scripts/temporal-test.ts:95
const ingestRes = memoryService.remember({
  ownerId: OWNER,
  role: "user",
  content: "I prefer working in the terminal with Neovim",
});
```

`IngestExperienceInput.type` is **required** (`domain/service.types.ts:21`), but
`typecheck` passed, and the failure surfaced at runtime as:

```
SqliteError: NOT NULL constraint failed: experiences.type
  at captureExperience (src/storage/db.ts:445:6)
  at capture (src/ingestion/capture.ts:18:10)
  at ingest (src/ingestion/ingest.ts:31:22)
  at Object.remember (src/service.ts:98:12)
  at scripts/temporal-test.ts:95:33
```

The error points at the **database**, not at the missing argument — so the worker
spent a retry debugging the wrong layer, and the harness (correctly) blocked the
item. With the test scripts included in the typecheck, the same defect reads:

```
scripts/temporal-test.ts(95,42): error TS2345: ... Property 'type' is missing in
  type '{ ownerId, role, content }' but required in type 'IngestExperienceInput'
```

Fixed by adding `packages/memory/tsconfig.typecheck.json` (includes `src` and
`scripts`, `rootDir: "."`) and pointing the package's `typecheck` script at it. The
build config is untouched: `tsc` → exit 0, `typecheck` → exit 0, and every existing
test script is clean.

**The general lesson:** a gate is only as good as its coverage. `typecheck` looked
like a strong gate and was checking barely half the code that mattered.

## 14. Three of the four packages have no tests at all

| Package | `test` script | What it really does |
|---|---|---|
| `packages/memory` | `tsx scripts/…` chain | 300 assertions, real coverage |
| `apps/server` | `echo 'no tests' && exit 0` | nothing |
| `apps/web` | `echo 'no tests' && exit 0` | nothing |
| `packages/agents` | `echo 'no tests' && exit 0` | nothing |
| `apps/cli` | `echo 'no tests' && exit 0` | nothing (it has one `bun:test` file that no script runs) |

So for the security remediation plan, a gate that runs `pnpm run test` in those
packages **proves nothing** — it exits 0 on an empty suite. The harness would also
reject any item that changes source without adding a test file, and there is no
runner for those tests to run in.

This is why the security checklist starts with **S0**: give those three packages the
repo's existing convention (plain `tsx scripts/<name>-test.ts`, no new dependency),
and extend their `tsconfig` so the typecheck covers the test files too. S0 must
land before the items it unblocks.

## 15. The two halves must not share a blind spot

The worker and the independent reviewer are meant to check each other. They read
the same `ITEM_TEXT`, so any defect in how that text is produced is a blind spot
both of them share — and the review gate then agrees with itself instead of with
the plan.

That is what bug 16 was: the item text was cut at the first line, so both halves
were judging "…currently have **no automated".

The general rule this suggests: **the reviewer only adds independence over the
*work*, never over the *instruction*.** If the instruction is wrong, two agents
reading it wrong are not two checks — they are one check, performed twice, with
the same blind spot. The independent review is worth what its input is worth.

The same applies to the diff the reviewer is given: the harness writes the diff
out to a file and hands over the path, so the reviewer sees exactly what the
gates saw. That is deliberate — the reviewer is there to judge *judgement*
questions the mechanical gates cannot decide, not to discover a different view
of the same bytes.

## 6. Windows specifics

- `pnpm` on PATH resolves to a `.cmd` ⇒ shell execution needed for spawn.
- `hc` prints JSON when piped; pass `--json` explicitly for scripts.
- `hc keys <t> enter` dismisses the Claude Code "auto mode billing" modal that can
  block a freshly spawned worker (their `ANTHROPIC_BASE_URL` is `localhost:20128`).
