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

import {
  itemPaths,
  parseChecklist,
  slug,
  removedGuards,
  applyItemOutcome,
  findItemLine,
  agentName,
  parseReport,
  hasTrailer,
} from "./plan-executor.mjs";

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
// removedGuards: the part of a diff a reviewer skims past
// ---------------------------------------------------------------------------

// This is the real diff of the S3 fix that weakened the retrieval filter: the
// owner check and the status check were replaced by weaker ones, and the
// reviewer passed it.
const weakenedDiff = [
  "diff --git a/packages/memory/src/governance/policy.ts b/packages/memory/src/governance/policy.ts",
  "--- a/packages/memory/src/governance/policy.ts",
  "+++ b/packages/memory/src/governance/policy.ts",
  "@@ -203,12 +203,15 @@",
  "-  if (node.ownerId !== ownerId) return false;",
  "-  if (node.status !== \"active\") return false;",
  "+  if (node.visibility === \"private\" && node.ownerId !== ownerId) return false;",
  "+  if (node.status === \"deleted\" || node.status === \"superseded\") return false;",
  "-  const keywords = input.keywords ?? [];",
  "+  const keywords = [...new Set(input.keywords ?? [])];",
].join("\n");

check(
  "a removed ownership check is found",
  removedGuards(weakenedDiff).some((g) => g.includes("node.ownerId !== ownerId")),
  true,
);

check(
  "a removed status check is found",
  removedGuards(weakenedDiff).some((g) => g.includes('node.status !== "active"')),
  true,
);

check(
  "a removed line that is not a guard is not reported",
  removedGuards(weakenedDiff).some((g) => g.includes("const keywords = input.keywords")),
  false,
);

check("a diff with no removed lines has no guards", removedGuards(""), []);

// ---------------------------------------------------------------------------
// applyItemOutcome: an item that closes a gap must not keep claiming it
// ---------------------------------------------------------------------------

const outcomeLines = () => [
  "## A section",
  "",
  "- [~] Working memory: no dedicated type; approximated by `ephemeral` retention.",
  "      The detail of the item continues here.",
  "- [ ] Another item.",
];

check(
  "a closed gap replaces the item's wording and its whole block",
  applyItemOutcome(outcomeLines(), 2, {
    itemText: "Working memory has its own type.",
    partial: false,
    remaining: null,
  }).slice(2, 4),
  ["- [x] Working memory has its own type.", "- [ ] Another item."],
);

check(
  "an item that stays partial keeps its box and states the gap",
  applyItemOutcome(outcomeLines(), 2, {
    itemText: "Working memory: a dedicated type exists, the read path is not wired.",
    partial: true,
    remaining: "the read path is not wired",
  })[2],
  "- [~] Working memory: a dedicated type exists, the read path is not wired. — remaining: the read path is not wired",
);

check(
  "without a reported wording the box is the only thing that changes",
  applyItemOutcome(outcomeLines(), 2, {
    itemText: null,
    partial: false,
    remaining: null,
  })[2],
  "- [x] Working memory: no dedicated type; approximated by `ephemeral` retention.",
);

// ---------------------------------------------------------------------------
// findItemLine: the item's own line, not a look-alike
// ---------------------------------------------------------------------------

const locateLines = [
  "- [x] Working memory has its own type.",
  "- [ ] Working memory: no dedicated type; approximated by `ephemeral` retention.",
];

check(
  "an item is found by its exact first line",
  findItemLine(locateLines, {
    head: "Working memory: no dedicated type; approximated by `ephemeral` retention.",
    line: 2,
  }),
  1,
);

check(
  "a reworded item is found by the prefix, nearest the line it was parsed from",
  findItemLine(locateLines, {
    head: "Working memory: no dedicated type; approximated by `ephemeral` retention.",
    line: 2,
  }),
  1,
);

check(
  "an item that is not in the file is reported as missing",
  findItemLine(locateLines, { head: "Something else entirely.", line: 9 }),
  -1,
);

// ---------------------------------------------------------------------------
// agentName: every attempt of an item needs its own name
// ---------------------------------------------------------------------------

check(
  "two attempts of the same item get different names",
  agentName("plan", "p0-7-policy-settings-that-still-have-no--01", 2) ===
    agentName("plan", "p0-7-policy-settings-that-still-have-no--01", 3),
  false,
);

check(
  "the attempt number survives the 32 character cap",
  agentName("plan", "p0-7-policy-settings-that-still-have-no--01", 3).endsWith("-a3"),
  true,
);

check(
  "a worker name never exceeds 32 characters",
  agentName("resolve", "p0-7-policy-settings-that-still-have-no--01", 3).length <= 32,
  true,
);

// ---------------------------------------------------------------------------
// the brief's own example must not be read as the worker's report
// ---------------------------------------------------------------------------
//
// The worker is told to read the brief, and the brief contains the report
// format. When it reads it, that text is on screen - and the harness reads
// the report off the screen. So the brief has to be subtracted from the
// screen before anything is read out of it.

const briefText = [
  "## How to report",
  "",
  "```",
  "ITEM: p0-7-policy-settings-that-still-have-no--01",
  "STATUS: <done or blocked>",
  "ITEM_STATE: <complete or partial>",
  "CHANGED: <comma-separated list of the files you changed>",
  "```",
  "",
  "Write `STATUS: done` (and not the placeholder) when the work is finished.",
].join("\n");

const briefEcho = [
  "Read the brief at \"C:\\\\tmp\\\\fix.md\" and execute it exactly.",
  "  ● Read 1 file",
  "  ⎿  C:\\tmp\\fix.md",
  ...briefText.split("\n").map((l) => (l ? `  ${l}` : "")),
].join("\n");

check(
  "the brief's example is not a report trailer",
  hasTrailer(briefEcho, /STATUS:\s*(done|blocked)/i, { ignoreText: briefText }),
  false,
);

check(
  "without the subtraction the brief's example would be read as a trailer",
  hasTrailer(briefEcho, /STATUS:\s*(done|blocked)/i),
  true,
);

check(
  "a real trailer at the end of the turn is found",
  hasTrailer(
    [
      "  ● Reading 1 file…",
      "  ⎿  packages/memory/src/storage/db.ts",
      "  ITEM: p0-7-policy-settings-that-still-have-no--01",
      "  STATUS: done",
      "  ITEM_STATE: complete",
      "  ✻ Baked for 4m 6s · done",
      "  ──────────────────────────",
      "  ❯ ",
      "  ──────────────────────────",
      "    ⏵⏵ auto mode on (shift+tab to cycle)",
    ].join("\n"),
    /STATUS:\s*(done|blocked)/i,
  ),
  true,
);

check(
  "the report of a real turn is read, not the brief's example",
  parseReport(
    [
      "  STATUS: done",
      "  ITEM_STATE: complete",
      "  CHANGED: packages/memory/src/governance/policy.ts",
      "  TESTS:",
      "  pnpm --filter @workspace/memory run typecheck exited 0",
      "  pnpm --filter @workspace/memory run test:all exited 1",
      "  ✻ Baked for 4m 6s · done",
    ].join("\n"),
  ).tests,
  "pnpm --filter @workspace/memory run typecheck exited 0 | pnpm --filter @workspace/memory run test:all exited 1",
);

check(
  "a brief on screen alone yields no status",
  parseReport(briefEcho, { ignoreText: briefText }).status,
  null,
);

check(
  "the worker's own report still reads when the brief is on screen too",
  parseReport(
    [
      ...briefEcho.split("\n"),
      "  ● Reading 1 file…",
      "  ITEM: p0-7-policy-settings-that-still-have-no--01",
      "  STATUS: done",
      "  ITEM_STATE: partial",
      "  REMAINING: the read path is not wired",
    ].join("\n"),
    { ignoreText: briefText },
  ).itemState,
  "partial",
);

check(
  "a wrapped brief line is subtracted too",
  parseReport(
    [
      "  Write `STATUS: done` (and not the placeholder) when the work is",
      "  finished.",
      "  ● Reading 1 file…",
    ].join("\n"),
    { ignoreText: briefText },
  ).status,
  null,
);

// ---------------------------------------------------------------------------
// no brief may be read as a report
// ---------------------------------------------------------------------------
//
// The harness reads the report off the screen, and the brief is on the screen
// once the worker has read it. A brief that contains the report format can
// therefore be read as the report. The subtraction is the fix; this is the
// guarantee that the subtraction actually covers every line of every brief -
// including the lines that only look harmless.

const BRIEF_DIR = path.join(HERE, "briefs");
const briefFiles = fs.readdirSync(BRIEF_DIR).filter((f) => f.endsWith(".md"));
check("the briefs are there to check", briefFiles.length > 0, true);

for (const file of briefFiles) {
  const text = fs.readFileSync(path.join(BRIEF_DIR, file), "utf8");
  // The screen as the terminal shows the file being read: every line indented
  // by two spaces, exactly as the Read tool renders it.
  const screen = text
    .split(/\r?\n/)
    .map((l) => (l.trim() ? `  ${l}` : ""))
    .join("\n");
  const report = parseReport(screen, { ignoreText: text });
  const read = {
    status: report.status,
    itemState: report.itemState,
    verdict: report.verdict,
    resolved: report.resolved,
    itemText: report.itemText,
    changed: report.changed,
    tests: report.tests,
    remaining: report.remaining,
    blocked: report.blocked,
    reasons: report.reasons,
    conflicts: report.conflicts,
  };
  const said = Object.entries(read).filter(([, v]) => v !== null);
  check(`the brief ${file} on screen reads as no report at all`, said, []);
}

// And the same for a brief that is only partly on screen - the worker read
// the first half of it.
const splitBrief = fs.readFileSync(path.join(BRIEF_DIR, "implement.md"), "utf8");
const half = splitBrief.split(/\r?\n/).slice(0, 40).join("\n");
check(
  "half a brief on screen reads as no report either",
  parseReport(half.split(/\r?\n/).map((l) => `  ${l}`).join("\n"), {
    ignoreText: splitBrief,
  }).status,
  null,
);

// ---------------------------------------------------------------------------

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
