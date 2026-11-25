# Conflict resolution brief

You are resolving a git rebase conflict for one plan item. Another item was
merged into the base branch after this item was written, and both touched the
same file.

## The item you are finishing

- Item: `s2-server-login-has-no-rate-limiting-01`
- Intent: The login route (`apps/server/src/modules/user/users.routes.ts:19`) accepts unlimited attempts, so passwords can be brute-forced. Add a rate limit (by IP and by account) with a clear response, and cover it with a test. The repo has no limiter dependency; a small in-memory limiter is enough — do not add a framework for this. Testing this: the same two traps as S1 apply — the test script must provide `JWT_SECRET` and `AI_MODEL` itself before it imports the app (set them at the top of the script and import the app with a dynamic `import()`), and every request needs a short timeout. Make sure the requests the test sends cannot reach the database (a request with an invalid body is answered by validation before any query), so the suite stays fast.

## The conflict

The item's branch is being rebased onto `eb77bddef232441c29c01e35b27a3d1ff558f0a5`. Git paused the rebase
and left conflict markers in these files:

- `apps/server/scripts/server-test.ts`
    - base side (already merged): D:\Projects\nimo-v2.0.0\nimo\.planning\plan-executor\plan-server\conflicts\s2-server-login-has-no-rate-limiting-01\01-server-test.ts.base
    - item side (this item): D:\Projects\nimo-v2.0.0\nimo\.planning\plan-executor\plan-server\conflicts\s2-server-login-has-no-rate-limiting-01\01-server-test.ts.item

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
