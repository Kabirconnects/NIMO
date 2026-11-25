# Progress — Plan Executor

## 2026-11-25

### Session 1 — Recon and calibration

- Confirmed herdr's agent API is `hc` (herdr-core CLI); corrected an earlier
  misdiagnosis that herdr was only a GUI. Spawned and drove 4 Claude workers
  (`t1f` rev-agents, `t1g` rev-web, `t1h` rev-memory, `t1j` rev-server) as
  read-only reviewers.
- Collected 4 reports; independently verified every high-severity claim against
  source. 4 of 18 early findings were fabricated; all of `t1g`'s re-briefed
  (narrow + proof-obligation) findings were real.
- Verified 8 real defects across `packages/memory`, `packages/agents`,
  `apps/server`, `apps/web` (see `findings.md` §4).
- Initialized plan `2026-11-25-plan-executor`.

### Session 3 — The demo, and the bugs only running it could find

- Built `tools/plan-executor/` (executor + 3 briefs + README), committed `074aae9`.
- Parsing: 16 open items (15 `[~]`, 1 `[ ]`) of 121 in the memory checklist.
- **Baseline discovery:** `test:all` fails on `main` — hardening suite 80/82. Root
  cause: commit `21484b7` (2026-11-13, an unrelated "manageProcessTool" commit)
  relaxed `MemoryPermissions.write` to `true` for every mode; the hardening test
  and the checklist still asserted the original rule.
- **User decision: restore mode-gated writes.** Implemented in three coordinated
  places (`runtime/context.ts`, `tools-mode.config.ts`, `system-prompt.ts`) —
  hardening suite back to **82/82**, typecheck green for memory + agents.
- Also fixed `pnpm-workspace.yaml`: `better-sqlite3` was missing from `allowBuilds`,
  so a fresh install died with `ERR_PNPM_IGNORED_BUILDS`. The first fix (`true`) was
  wrong — it made pnpm run a native build that fails without a toolchain. The
  correct form is the explicit skip, `better-sqlite3: false` (as `msw` already is).
  Verified in a scratch worktree with `node_modules` deleted: install exits 0,
  `require('better-sqlite3')` works.
- Baseline re-recorded after the fix: typecheck OK, lint OK, `test:all` OK, 0 failures.

### Harness bugs found and fixed by running it

Five runs to get one merge. Each failure was real:

| # | Symptom | Fix |
|---|---|---|
| 1 | item blocked, "pnpm install failed" | `installDeps()` self-heals pnpm's build policy |
| 2 | crash: `matchAll called with a non-global RegExp` | report regexes needed `/g` |
| 3 | stray worker files invisible to the gates | gates also scan untracked files |
| 4 | `name_taken` crash on rerun | `spawnAgent()` reclaims the name |
| 5 | item restarted from zero after a crash | `makeWorktree()` reuses the worktree |
| 6 | **item blocked for scope violations it never committed** | reused worktrees are rebased onto the current base |
| 7 | every gate failed with a pnpm stack trace | the install patch survives until commit time, then is restored |
| 8 | rebase conflict on `pnpm-workspace.yaml` | surgical edit that preserves line endings |
| 9 | **reviewer returned "NO VERDICT"** | wait for the agent's TUI to be ready before sending |
| 10 | **reviewer verdict parsed as "E"** | the report parser returned the match, not the capture group |
| 11 | a turn "finished" instantly with no output | the report trailer is the completion signal |

Full table with root causes: `findings.md` §10.

### Demo result — the first item, end to end

`p3-verification-regression-10` (the one `[ ]` item) went through the whole pipeline:

```
implementer -> mechanical gates (scope, leftovers, tests, 3 commands) -> PASS
            -> independent reviewer -> PASS
            -> rebase -> re-gate -> merge -> checklist flipped -> evidence written
```

Merged in `110615f`, checklist updated in `a610189`. Verified independently, not by
the harness's word: the test runs green in the main repo (16/16) and is wired into
`test:all`; the full memory suite is green (154 + 28 + 20 + 82 + 16).

### The reviewer is not a proof

The merged test asserted that `graph_degree` matches the edge table — *after* calling
`repairGraphDegrees()`, which makes the assertion true by construction. The reviewer
returned `VERDICT: PASS`. Fixed by hand (the check now runs against the un-repaired
state; it passes, so the incremental maintenance is actually correct) and two harness
changes followed:

- **G7, a mechanical proof gate**: when an item changes source, its tests are re-run
  against the pre-change source. If they still pass, they prove nothing and the item
  is rejected. Mechanics verified (a no-op source change leaves the suite green, and
  the worker's source is restored byte-for-byte — identical SHA256).
- The review brief now asks for "assertions that are true by construction".

See `findings.md` §11.

### Environment quirks the team hit

- The Claude Code **Bash classifier is unavailable** through the `localhost:20128`
  gateway, so workers often cannot run shell commands themselves. The harness runs
  the gates mechanically, so this does not block correctness — the briefs now tell
  workers to report it instead of looping.
- Workers can also stall in a long `Forming…` phase; `hc keys <t> esc` interrupts
  cleanly and the harness continues with the diff it produced.
- The worker left `MEMORY.md` and `ITEM_COMPLETE.md` at the worktree root on its
  first attempt. The scope gate caught them — but only after it was extended to see
  untracked files. The briefs now say so explicitly.

### State of workers

| Terminal | Name | Role | State |
|---|---|---|---|
| `t1f` | rev-agents | reviewer | idle at prompt (read-only) |
| `t1g` | rev-web | reviewer | idle at prompt (read-only) |
| `t1h` | rev-memory | reviewer | idle at prompt (read-only) |
| `t1j` | rev-server | reviewer | idle at prompt (read-only) |
| `t1w` | plan-c-temporal-memory-03 | implementer | working (second demo item) |

The first four ran in `~\.herdr\worktrees\nimo\workspace` (branch `workspace`, clean,
commit `63c73b0` = main). Nothing to merge; nothing modified.

### Next

Phase 6 — validate the harness on a source-changing item (`c-temporal-memory-03`),
which is the case that exercises the new G7 proof gate. Then decide whether to run
the remaining 14 partial items and turn the 8 verified review defects into an
executable checklist of their own.
