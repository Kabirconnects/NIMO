# Conflict resolution brief

You are resolving a git rebase conflict for one plan item. Another item was
merged into the base branch after this item was written, and both touched the
same file.

## The item you are finishing

- Item: `s8-web-the-production-api-url-is-a-place-01`
- Intent: `apps/web/src/lib/api-client.ts:3-4` falls back to `https://api.yourdomain.com` when `VITE_API_URL` is unset. In production the app then talks to a domain that does not exist. Fail loudly with a clear configuration error instead of silently using a placeholder. Testing this: `api-client.ts` reads `import.meta.env`, which is undefined under plain Node — a test cannot import it. Put the URL decision in its own module that takes the environment as an argument (e.g. `{ prod, configuredUrl }`) and throws a clear configuration error when the production URL is missing; use it from `api-client.ts` and test that module.

## The conflict

The item's branch is being rebased onto `e3ecbf2a43bf2e1f74987381bd53e13f6b834b3d`. Git paused the rebase
and left conflict markers in these files:

- `apps/web/scripts/web-test.ts`
    - base side (already merged): D:\Projects\nimo-v2.0.0\nimo\.planning\plan-executor\plan-server\conflicts\s8-web-the-production-api-url-is-a-place-01\01-web-test.ts.base
    - item side (this item): D:\Projects\nimo-v2.0.0\nimo\.planning\plan-executor\plan-server\conflicts\s8-web-the-production-api-url-is-a-place-01\01-web-test.ts.item

For each of them, both versions are written out for you:

- the **base side** is what is already merged on the base branch (the other
  item's reviewed work),
- the **item side** is what this item produced.

The exact paths are listed above.

## What to do

1. Read each conflicted file in the worktree. It contains the usual
   `<<<<<<<`, `=======`, `>>>>>>>` markers.
2. Resolve every conflict so that **both sides' intent survives**. Never
   resolve a conflict by keeping one side and discarding the other - the other
   side is a merged, reviewed item, and dropping it silently undoes it.
   - If the two sides changed different parts of a file, keep both.
   - If they changed the same line, combine them: both behaviours usually have
     to hold at once. A route that must be authenticated *and* rate-limited
     needs both middlewares, not one of them.
   - Keep the style of the surrounding file.
   - Do not weaken a security property to make a conflict go away.
3. Remove every conflict marker. `git grep -n '^<<<<<<<\|^=======\|^>>>>>>>'`
   must find nothing.
4. Stage the resolved files and finish the rebase:
   `git add <the resolved files>` then `GIT_EDITOR=true git rebase --continue`.
   Accept the commit message git offers.
5. Change nothing else. Do not reformat, do not "improve" code that is not part
   of a conflict, do not add tests, do not touch the checklist, do not commit
   anything else.

The orchestrator re-runs every test and an independent review after you finish.
If your resolution drops one side's behaviour, the tests for that side fail and
the item is blocked.

## Report

End your report with exactly:

```
RESOLVED: yes
CONFLICTS: <one short line per conflict: what it was, and how you combined the two sides>
```
