// Self-test for the plan executor's pure functions.
//
// The harness is judged by what it lets through, so the parts that decide
// *where to look* and *what an item is* are worth testing on their own.
//
//   node tools/plan-executor/selftest.mjs
//
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { itemPaths, parseChecklist, slug } from "./plan-executor.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`PASS  ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL  ${label}\n        got  ${a}\n        want ${e}`);
}

function checkThat(label, condition, detail = "") {
  if (condition) {
    console.log(`PASS  ${label}`);
    return;
  }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
}

// ---------------------------------------------------------------------------
// itemPaths: the focus line is the first thing a worker reads
// ---------------------------------------------------------------------------

const scopeRels = ["apps/server", "apps/web", "packages/memory", "packages/agents"];

check(
  "a repo-relative path with a line number resolves to the file",
  itemPaths(
    { text: "The login route (`apps/server/src/modules/user/users.routes.ts:19`) accepts unlimited attempts." },
    path.resolve(REPO_ROOT, "apps/server"), REPO_ROOT, scopeRels,
  ),
  ["apps/server/src/modules/user/users.routes.ts"],
);

check(
  "a package-relative path resolves against the package the item is about",
  itemPaths(
    { text: "`apps/web/src/lib/api-error.ts:34-35` returns any `Error.message`. Run it with `tsx scripts/web-test.ts`." },
    path.resolve(REPO_ROOT, "apps/server"), REPO_ROOT, scopeRels,
  ),
  ["apps/web/src/lib/api-error.ts", "apps/web/scripts/web-test.ts"],
);

check(
  "a file the item is going to create lands in the item's package",
  itemPaths(
    { text: "`DEFAULT_POLICY` is hardcoded at `packages/memory/src/service.ts:57`. Put the new test in `scripts/policy-test.ts`." },
    path.resolve(REPO_ROOT, "apps/server"), REPO_ROOT, scopeRels,
  ),
  ["packages/memory/src/service.ts", "packages/memory/scripts/policy-test.ts"],
);

check(
  "a path in another package is still found",
  itemPaths(
    { text: "`packages/agents/src/tools/shared/process.ts:589` builds the command line." },
    path.resolve(REPO_ROOT, "apps/server"), REPO_ROOT, scopeRels,
  ),
  ["packages/agents/src/tools/shared/process.ts"],
);

checkThat(
  "a bare file name is not resolved to the repository root",
  !itemPaths(
    { text: "`api-error.ts` imports only axios." },
    path.resolve(REPO_ROOT, "apps/server"), REPO_ROOT, scopeRels,
  ).some((p) => !p.includes("/")),
);

// ---------------------------------------------------------------------------
// parseChecklist: the item the worker gets
// ---------------------------------------------------------------------------

const checklist = path.join(REPO_ROOT, ".planning", "selftest-checklist.md");
fs.writeFileSync(
  checklist,
  [
    "# Self-test checklist",
    "",
    "## First section",
    "",
    "- [ ] The first item is one line.",
    "- [ ] The second item is several lines,",
    "      and the detail continues here.",
    "      It even continues again.",
    "- [x] A finished item.",
    "- [~] A partial item.",
    "",
    "## Second section",
    "",
    "- [ ] An item in the second section.",
    "",
  ].join("\n"),
  "utf8",
);

const { items } = parseChecklist(checklist);
fs.rmSync(checklist, { force: true });

check("the item ids follow the section and the order", items.map((i) => i.id), [
  "first-section-01",
  "first-section-02",
  "first-section-03",
  "first-section-04",
  "second-section-01",
]);

check(
  "a multi-line item reaches the worker whole",
  items[1].text,
  "The second item is several lines, and the detail continues here. It even continues again.",
);

check("the item state is read from the checkbox", items.map((i) => i.state), [
  "open", "open", "done", "partial", "open",
]);

check("the slug is stable", slug("S1 — Server: user routes have no authentication"),
  "s1-server-user-routes-have-no-authentica");

// ---------------------------------------------------------------------------

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
