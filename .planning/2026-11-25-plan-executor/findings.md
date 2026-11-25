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

## 6. Windows specifics

- `pnpm` on PATH resolves to a `.cmd` ⇒ shell execution needed for spawn.
- `hc` prints JSON when piped; pass `--json` explicitly for scripts.
- `hc keys <t> enter` dismisses the Claude Code "auto mode billing" modal that can
  block a freshly spawned worker (their `ANTHROPIC_BASE_URL` is `localhost:20128`).
