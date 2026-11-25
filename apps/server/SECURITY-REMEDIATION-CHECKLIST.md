# Security & Correctness Remediation Checklist

**Status:** Open. Every item below was found by an independent review agent and then
verified by hand against the source — the exact lines are quoted so it can be re-checked.
**Last updated:** 2026-11-25

**Source:** the four-agent review of `packages/agents`, `apps/web`, `packages/memory`
and `apps/server` (2026-11-25). Each finding was re-read in the source before it was
accepted here; four other findings from that review were rejected as fabrications.

**How this file is executed:** the plan executor drives it with one worktree and one
worker per item, mechanical gates (scope, no leftovers, tests exist, typecheck, lint,
tests, proof), and an independent reviewer per item:

```sh
node tools/plan-executor/plan-executor.mjs \
  --checklist apps/server/SECURITY-REMEDIATION-CHECKLIST.md \
  --scope apps/server,apps/web,packages/memory,packages/agents \
  --base main --workers 2 --attempts 3
```

Workers never edit this file. The orchestrator flips the checkboxes and writes the
Evidence Log, so parallel item branches never conflict.

---

## S1 — Server: user routes have no authentication

- [ ] `GET /`, `GET /:id`, `PATCH /:id` and `DELETE /:id` under the user module are
      mounted without `authMiddleware` (`apps/server/src/modules/user/users.routes.ts:16,25,26,27`).
      Today the handlers are `// TODO` stubs (`users.controller.ts:14,25,179,188`), so
      nothing leaks — but a request to them hangs forever instead of answering. Apply
      the same authentication the other protected modules use, and make the stub
      handlers answer with a clear error instead of hanging.

## S2 — Server: login has no rate limiting

- [ ] The login route (`apps/server/src/modules/user/users.routes.ts:19`) accepts
      unlimited attempts, so passwords can be brute-forced. Add a rate limit (by IP
      and by account) with a clear response, and cover it with a test.

## S3 — Memory: the per-owner policy is never loaded

- [ ] `DEFAULT_POLICY` is hardcoded at `packages/memory/src/service.ts:57,116,294,400`,
      `packages/memory/src/ingestion/ingest.ts:48,68`,
      `packages/memory/src/workers/ingestion.worker.ts:34` and
      `packages/memory/src/tools.ts:252,289`. `packages/memory/src/governance/policy.ts:148`
      even takes an unused `_policy` parameter. The `memory_policies` table is never
      consulted, so a user's own policy settings are ignored. Load the owner's policy
      and use it on every write path.

## S4 — Agents: command reuse collides on the joined command line

- [ ] `packages/agents/src/tools/shared/process.ts:589` builds
      `commandLine = argv.join(" ")`, matched at `:697-700`, so `["run","a b"]` and
      `["run","a","b"]` are treated as the same process. Reusing a process by that
      string can attach to the wrong one. Key the process by the argv array itself,
      and cover the collision with a test.

## S5 — Web: a transient 5xx logs the user out

- [ ] `apps/web/src/features/auth/hooks/use-session.ts:32` sets `retry: false` and
      `apps/web/src/components/protected-route.tsx:28` redirects on `if (!user)`;
      `isError` is never checked. A server hiccup therefore signs the user out.
      Distinguish "not signed in" from "could not check", and only redirect on the
      former.

## S6 — Web: logout leaves a stale session behind on error

- [ ] `apps/web/src/features/auth/hooks/use-logout.ts:15-17` clears the cache only in
      `onSuccess`, with no `onError`. If the logout request fails, the client keeps
      the old session cached. Clear it in both paths.

## S7 — Web: raw internal error text reaches the UI

- [ ] `apps/web/src/lib/api-error.ts:34-35` returns any `Error.message` to the user,
      which can expose internal details. Show a safe, human-readable message and keep
      the raw text for logging only.

## S8 — Web: the production API URL is a placeholder

- [ ] `apps/web/src/lib/api-client.ts:3-4` falls back to
      `https://api.yourdomain.com` when `VITE_API_URL` is unset. In production the
      app then talks to a domain that does not exist. Fail loudly with a clear
      configuration error instead of silently using a placeholder.

---

## Evidence Log

_Evidence is written here by the plan executor, not by workers. Each entry records the
gate commands that were actually run, the number of files changed, and the independent
reviewer's verdict._
