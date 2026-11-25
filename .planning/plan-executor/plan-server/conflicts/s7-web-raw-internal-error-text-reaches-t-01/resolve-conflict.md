# Conflict resolution brief

You are resolving a git rebase conflict for one plan item. Another item was
merged into the base branch after this item was written, and both touched the
same file.

## The item you are finishing

- Item: `s7-web-raw-internal-error-text-reaches-t-01`
- Intent: `apps/web/src/lib/api-error.ts:34-35` returns any `Error.message` to the user, which can expose internal details. Show a safe, human-readable message and keep the raw text for logging only. Testing this: `api-error.ts` imports only axios, so a test can import it directly under plain Node (`tsx scripts/web-test.ts`, the runner the web package uses — follow the pattern of the existing test modules there). The test should show that a plain `Error` carrying an internal message yields a safe message instead, and that the axios error path still returns the server's own message.

## The conflict

The item's branch is being rebased onto `195c129e5400e3eeb956353c5e155f4161512ddf`. Git paused the rebase
and left conflict markers in these files:

- `apps/web/scripts/web-test.ts`
    - base side (already merged): D:\Projects\nimo-v2.0.0\nimo\.planning\plan-executor\plan-server\conflicts\s7-web-raw-internal-error-text-reaches-t-01\01-web-test.ts.base
    - item side (this item): D:\Projects\nimo-v2.0.0\nimo\.planning\plan-executor\plan-server\conflicts\s7-web-raw-internal-error-text-reaches-t-01\01-web-test.ts.item

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
