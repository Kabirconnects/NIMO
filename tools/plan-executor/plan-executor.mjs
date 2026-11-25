#!/usr/bin/env node
/**
 * plan-executor.mjs — drive a markdown checklist to completion with a team of agents.
 *
 * Zero dependencies. Needs: node >= 20, git, pnpm, and herdr's `hc` CLI on PATH.
 *
 *   node tools/plan-executor/plan-executor.mjs \
 *     --checklist packages/memory/IMPLEMENTATION-CHECKLIST.md
 *
 * The worker is never trusted. Every item passes mechanical gates (scope, no
 * leftovers, tests present, commands green) plus an independent reviewer agent
 * before the orchestrator merges it and records the evidence itself.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const BRIEFS = path.join(HERE, "briefs");

// ---------------------------------------------------------------------------
// process helpers
// ---------------------------------------------------------------------------

function resolveExe(name) {
  if (path.isAbsolute(name) && fs.existsSync(name)) return name;
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";");
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of ["", ...exts]) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (fs.existsSync(candidate)) return candidate;
      const upper = path.join(dir, name + ext);
      if (fs.existsSync(upper)) return upper;
    }
  }
  return name;
}

/** Run a binary with an argv array. No shell, so nothing needs escaping. */
function execBin(bin, args, { cwd, timeout = 600_000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(resolveExe(bin), args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr, timedOut });
    });
  });
}

/** Run a shell command line. Use for .cmd shims like pnpm. */
function execCmd(command, { cwd, timeout = 600_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr, timedOut });
    });
  });
}

const git = (args, cwd = REPO_ROOT, timeout = 120_000) =>
  execBin("git", args, { cwd, timeout });
const hc = (args, { cwd, timeout = 120_000 } = {}) =>
  execBin("hc", args, { cwd, timeout });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    checklist: null,
    base: "main",
    workers: 2,
    attempts: 3,
    only: [],
    dryRun: false,
    pkg: null,
    planId: null,
    maxItems: Infinity,
    turnTimeout: 1800,
    keepBlocked: true,
    includePartial: true,
    gates: null,
    recordBaseline: false,
    parent: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--checklist") out.checklist = next();
    else if (a === "--base") out.base = next();
    else if (a === "--workers") out.workers = Number(next());
    else if (a === "--attempts") out.attempts = Number(next());
    else if (a === "--only") out.only = next().split(",").map((s) => s.trim());
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--package") out.pkg = next();
    else if (a === "--plan-id") out.planId = next();
    else if (a === "--max-items") out.maxItems = Number(next());
    else if (a === "--turn-timeout") out.turnTimeout = Number(next());
    else if (a === "--gates") out.gates = next().split(";").map((s) => s.trim()).filter(Boolean);
    else if (a === "--drop-blocked") out.keepBlocked = false;
    else if (a === "--record-baseline") out.recordBaseline = true;
    else if (a === "--parent") out.parent = next();
    else if (a === "--open-only") out.includePartial = false;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const USAGE = `
plan-executor — drive a checklist to completion with a team of agents

  --checklist <path>     markdown checklist (required)
  --base <branch>        branch to build on and merge into (default: main)
  --package <name>       pnpm workspace package (default: inferred from checklist path)
  --workers <n>          items implemented in parallel (default: 2)
  --attempts <n>         implement attempts per item before giving up (default: 3)
  --only <id,id>         run only these item ids
  --max-items <n>        stop after n items
  --gates "<cmd;cmd>"    override gate commands
  --turn-timeout <sec>   max wait per agent turn (default: 1800)
  --open-only            only items marked [ ] (skip [~] partial ones)
  --drop-blocked         delete worktrees of blocked items (default: keep them)
  --dry-run              parse and print the plan, change nothing
`;

// ---------------------------------------------------------------------------
// checklist parsing
// ---------------------------------------------------------------------------

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function parseChecklist(file) {
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const items = [];
  let section = "(root)";
  let evidenceHeading = -1;
  const sectionCounts = new Map();

  lines.forEach((line, index) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      const title = heading[1].trim();
      if (/^evidence log/i.test(title)) evidenceHeading = index;
      if (/^#{2,3}\s/.test(line)) section = title;
      return;
    }
    const match = /^\s*-\s*\[( |x|~)\]\s+(.*)$/.exec(line);
    if (!match) return;
    const n = (sectionCounts.get(section) ?? 0) + 1;
    sectionCounts.set(section, n);
    items.push({
      id: `${slug(section)}-${String(n).padStart(2, "0")}`,
      state: match[1] === " " ? "open" : match[1] === "~" ? "partial" : "done",
      text: match[2].trim(),
      line: index + 1,
      section,
      raw: line,
    });
  });

  return { raw, lines, items, evidenceHeading };
}

/** Paths named by the item, e.g. `src/storage/db.ts`, resolved to package-relative. */
function itemPaths(item, packageRoot) {
  const found = new Set();
  const candidates = [];
  for (const m of item.text.matchAll(/`([^`]+)`/g)) candidates.push(m[1]);
  for (const m of item.text.matchAll(/\b((?:src|scripts|test|tests)\/[\w./*-]+)/g))
    candidates.push(m[1]);
  for (const raw of candidates) {
    const token = raw.trim().replace(/[.,;)]+$/, "");
    if (!token || token.length > 120) continue;
    if (!/[/\\]|\.(ts|tsx|js|json|md)$/.test(token)) continue;
    if (/^https?:/i.test(token)) continue;
    const normalized = token.replace(/\\/g, "/");
    found.add(normalized);
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// gates
// ---------------------------------------------------------------------------

const LEFTOVER_PATTERNS = [
  { label: "TODO", re: /\bTODO\b/ },
  { label: "FIXME", re: /\bFIXME\b/ },
  { label: "XXX", re: /\bXXX\b/ },
  { label: "HACK", re: /\bHACK\b/ },
  { label: "not implemented", re: /not\s+implemented|unimplemented|not\s+yet\s+implemented/i },
  { label: "@ts-ignore", re: /@ts-ignore|@ts-expect-error/ },
  { label: "stub", re: /\bstub\b/i },
];

const TEST_FILE_RE = /(^|\/)(test|tests|spec|__tests__)\/|(^|\/)[^/]*\.(test|spec)\.[jt]sx?$|scripts\/[^/]*-test\.ts$/i;

/** Failing test identifiers in a suite's output, e.g. "FAIL [PERMISSIONS] Chat cannot write memory". */
function collectFailures(output) {
  const found = new Set();
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*FAIL\s+(.+?)\s*$/.exec(line);
    if (m) found.add(m[1].trim());
  }
  return [...found];
}

/**
 * Install dependencies in a worktree.
 *
 * pnpm refuses to run dependency build scripts unless they are allow-listed, and
 * it exits non-zero when it ignores one - which breaks every fresh worktree for a
 * repo that has a native dependency. Self-heal: allow the ignored packages, retry,
 * then restore the tracked file so the item's diff stays clean.
 */
async function installDeps(worktree, log) {
  const cmd = "pnpm install --frozen-lockfile --prefer-offline";
  const run = () => execCmd(cmd, { cwd: worktree, timeout: 1_800_000 });
  let r = await run();
  if (r.code === 0) return { ok: true };

  const output = `${r.stdout}\n${r.stderr}`;
  const ignored = /Ignored build scripts:\s*(.+)/i.exec(output);
  if (!ignored) return { ok: false, output };

  const names = [
    ...new Set(
      ignored[1]
        .split(",")
        .map((s) => s.trim().split("@")[0].trim())
        .filter(Boolean),
    ),
  ];
  log(`    install blocked by pnpm build policy for: ${names.join(", ")} - allow-listing and retrying`);

  const wsFile = path.join(worktree, "pnpm-workspace.yaml");
  if (!fs.existsSync(wsFile)) return { ok: false, output };
  const text = fs
    .readFileSync(wsFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => !/set this to true or false/.test(l))
    .join("\n");
  const add = names.map((n) => `  ${n}: true`).join("\n");
  const patched = /allowBuilds:/.test(text)
    ? text.replace(/allowBuilds:\n/, `allowBuilds:\n${add}\n`)
    : `${text}\nallowBuilds:\n${add}\n`;
  fs.writeFileSync(wsFile, patched, "utf8");

  r = await run();
  await git(["checkout", "--", "pnpm-workspace.yaml"], worktree);
  return { ok: r.code === 0, output: `${r.stdout}\n${r.stderr}` };
}

async function runGates({
  worktree, base, item, packageRoot, checklistRel, gates, baseline, onLog,
}) {
  const failures = [];
  const notes = [];

  const diffRes = await git(["diff", "--name-only", base], worktree);
  const changed = diffRes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Untracked files are invisible to `git diff` but would be swept into the
  // commit by `git add -A`, so they must be part of every check.
  const untrackedRes = await git(["ls-files", "--others", "--exclude-standard"], worktree);
  const untracked = untrackedRes.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const allFiles = [...new Set([...changed, ...untracked])];

  if (!allFiles.length) {
    failures.push({
      gate: "diff",
      detail: "the worktree contains no changes at all - the item was not implemented",
    });
    return { failures, changed: allFiles, notes };
  }

  // scope: stay inside the package, never touch the checklist, bounded file count
  const pkgRel = path.relative(REPO_ROOT, packageRoot).replace(/\\/g, "/");
  const ROOT_CONFIG_ALLOW = new Set([
    "pnpm-workspace.yaml", "package.json", "pnpm-lock.yaml", "turbo.json",
    "tsconfig.json", ".npmrc",
  ]);
  const outside = allFiles.filter(
    (f) => !f.startsWith(pkgRel + "/") && f !== pkgRel && !ROOT_CONFIG_ALLOW.has(f),
  );
  if (outside.length) {
    failures.push({
      gate: "scope",
      detail: `changed files outside ${pkgRel}: ${outside.join(", ")}. Remove stray files or move the change inside the package.`,
    });
  }
  const rootConfigChanged = allFiles.filter((f) => ROOT_CONFIG_ALLOW.has(f));
  if (rootConfigChanged.length) {
    notes.push(`shared root config changed: ${rootConfigChanged.join(", ")} (must be justified)`);
  }
  if (changed.includes(checklistRel) || untracked.includes(checklistRel)) {
    failures.push({
      gate: "scope",
      detail: `the checklist file ${checklistRel} was edited by the worker - the orchestrator owns that file`,
    });
  }
  if (allFiles.length > 15) {
    failures.push({
      gate: "scope",
      detail: `too many files changed (${allFiles.length}); the item should be narrow`,
    });
  }

  // leftovers on added lines only, plus the whole content of new files
  const patch = (await git(["diff", "-U0", base], worktree)).stdout;
  const added = patch
    .split(/\r?\n/)
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));
  for (const file of untracked) {
    const abs = path.join(worktree, file);
    try {
      const text = fs.readFileSync(abs, "utf8");
      added.push(...text.split(/\r?\n/));
    } catch {
      /* binary or unreadable - nothing to scan */
    }
  }
  for (const { label, re } of LEFTOVER_PATTERNS) {
    const hits = added.filter((l) => re.test(l));
    if (hits.length) {
      failures.push({
        gate: "leftovers",
        detail: `added lines contain ${label}: ${hits.slice(0, 3).map((h) => h.trim().slice(0, 120)).join(" | ")}`,
      });
    }
  }

  // tests must exist for source changes
  const sourceChanged = allFiles.filter((f) => /(^|\/)src\//.test(f));
  const testChanged = allFiles.filter((f) => TEST_FILE_RE.test(f));
  if (sourceChanged.length && !testChanged.length) {
    failures.push({
      gate: "tests",
      detail: `source files changed (${sourceChanged.join(", ")}) but no test file was added or changed - the item is not proven`,
    });
  }
  if (sourceChanged.length && testChanged.length) {
    notes.push(`tests touched: ${testChanged.join(", ")}`);
  }

  // commands
  const results = [];
  for (const cmd of gates) {
    onLog?.(`    gate: ${cmd}`);
    const r = await execCmd(cmd, { cwd: worktree, timeout: 1_200_000 });
    const output = `${r.stdout}\n${r.stderr}`;
    const tail = output.trim().split(/\r?\n/).slice(-12).join("\n");
    const currentFailures = collectFailures(output);
    const known = baseline?.commands?.[cmd] ?? [];
    const newFailures = currentFailures.filter((f) => !known.includes(f));
    results.push({
      cmd,
      code: r.code,
      tail,
      currentFailures,
      newFailures,
      preExisting: currentFailures.filter((f) => known.includes(f)),
    });

    if (r.code !== 0) {
      if (newFailures.length) {
        failures.push({
          gate: "command",
          detail: `\`${cmd}\` exited ${r.code} with NEW failures: ${newFailures.slice(0, 5).join(" | ")}`,
        });
      } else if (known.length) {
        onLog?.(
          `    note: ${known.length} pre-existing failure(s) in this suite are baselined, not caused by this item`,
        );
      } else {
        failures.push({
          gate: "command",
          detail: `\`${cmd}\` exited ${r.code} and no baseline covers it. Output tail:\n${tail}`,
        });
      }
    }
  }

  return { failures, changed, notes, commandResults: results };
}

// ---------------------------------------------------------------------------
// agent plumbing
// ---------------------------------------------------------------------------

async function agentStatus(address) {
  const r = await hc(["get", address, "--json"]);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/** hc names are limited to 32 chars of [a-z0-9-_]. */
function agentName(prefix, itemId) {
  return `${prefix}-${itemId}`.slice(0, 32).replace(/-+$/, "");
}

async function spawnAgent(name, cwd, parent) {
  // The harness owns these names. A previous run may still hold one, so reclaim
  // it before spawning rather than dying on "name_taken".
  try {
    const list = JSON.parse((await hc(["ls", "--json"])).stdout);
    const clash = (list.terminals ?? []).find(
      (t) => t.name === name && t.state === "live",
    );
    if (clash) {
      await hc(["kill", clash.address]);
      await sleep(500);
    }
  } catch {
    /* listing is best-effort */
  }

  const args = ["run", "--bg", "--json", "--no-notify", "--name", name, "--cwd", cwd];
  if (parent) args.push("--parent", parent);
  args.push("claude");
  let r = await hc(args);
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    /* handled below */
  }
  if (parsed?.error?.kind === "name_taken") {
    // fall back to a unique name rather than failing the item
    const unique = `${name.slice(0, 24)}-${Date.now().toString(36).slice(-5)}`.slice(0, 32);
    args[args.indexOf("--name") + 1] = unique;
    r = await hc(args);
    try {
      parsed = JSON.parse(r.stdout);
    } catch {
      parsed = null;
    }
  }
  if (!parsed?.address) {
    throw new Error(`could not spawn agent ${name}: ${r.stdout}${r.stderr}`);
  }
  return parsed;
}

async function readScreen(address) {
  const r = await hc(["read", address]);
  return r.stdout;
}

async function unstick(address) {
  const screen = await readScreen(address);
  if (/Enter to continue/i.test(screen)) {
    await hc(["keys", address, "enter"]);
    return "dismissed a modal";
  }
  if (/waiting for your input|press enter/i.test(screen)) {
    await hc(["keys", address, "enter"]);
    return "pressed enter";
  }
  return null;
}

/** Send a prompt and wait for that turn to end. Returns the screen text afterwards. */
async function sendAndWait(address, text, { timeout = 1800 } = {}) {
  await hc(["send", address, text, "--json"]);
  const deadline = Date.now() + timeout * 1000;
  let unsticks = 0;
  for (;;) {
    const status = await agentStatus(address);
    const state = status?.status?.state ?? status?.state ?? "unknown";
    if (state !== "working") {
      if (state === "blocked" && unsticks < 2) {
        unsticks++;
        const what = await unstick(address);
        if (what) {
          await sleep(1500);
          continue;
        }
      }
      break;
    }
    if (Date.now() > deadline) break;
    await sleep(3000);
  }
  return readScreen(address);
}

function parseReport(screen) {
  const lines = screen.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-120);
  const joined = tail.join("\n");
  const last = (re) => {
    const matches = [...joined.matchAll(re)];
    return matches.length ? matches[matches.length - 1][0] : null;
  };
  return {
    status: last(/STATUS:\s*(done|blocked)/gi)?.[1]?.toLowerCase() ?? null,
    verdict: last(/VERDICT:\s*(PASS|FAIL)/gi)?.[1]?.toUpperCase() ?? null,
    changed: last(/CHANGED:\s*(.+)/gi)?.[1]?.trim() ?? null,
    tests: last(/TESTS:\s*(.+)/gi)?.[1]?.trim() ?? null,
    reasons: last(/REASONS:\s*([\s\S]+)/gi)?.[1]?.trim() ?? null,
    blocked: last(/BLOCKED:\s*(.+)/gi)?.[1]?.trim() ?? null,
    tail,
  };
}

// ---------------------------------------------------------------------------
// worktrees
// ---------------------------------------------------------------------------

async function makeWorktree(root, branch, base) {
  // Reuse an existing worktree (a previous run may have left real work in it).
  const existing = await git(["worktree", "list", "--porcelain"], REPO_ROOT);
  if (existing.stdout.includes(`worktree ${root.replace(/\\/g, "/")}`)) {
    return { reused: true };
  }
  fs.mkdirSync(path.dirname(root), { recursive: true });
  await git(["worktree", "add", "-b", branch, root, base], REPO_ROOT, 300_000);
  return { reused: false };
}

async function removeWorktree(root, branch) {
  await git(["worktree", "remove", "--force", root], REPO_ROOT, 120_000);
  await git(["branch", "-D", branch], REPO_ROOT, 60_000);
}

// ---------------------------------------------------------------------------
// the item pipeline
// ---------------------------------------------------------------------------

function renderBrief(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

async function runItem(item, ctx) {
  const {
    args, base, packageRoot, checklistRel, checklistAbs, gates, state, log,
  } = ctx;
  const itemId = item.id;
  const branch = `plan/${itemId}`;
  const worktree = path.join(ctx.worktreeRoot, itemId);
  const briefDir = path.join(os.tmpdir(), "nimo-plan", ctx.planId, itemId);
  fs.mkdirSync(briefDir, { recursive: true });

  const paths = itemPaths(item, packageRoot);
  const allowed =
    paths.length
      ? paths.map((p) => path.join(packageRoot, p)).join(", ")
      : packageRoot;
  const gateText = gates.join("\n");

  log(`  worktree: ${worktree}`);
  log(`  scope:    ${allowed}`);

  const wt = await makeWorktree(worktree, branch, base);
  if (wt.reused) log("  reusing the existing worktree from a previous run");

  // dependencies for the worktree (pnpm store makes this quick)
  if (!fs.existsSync(path.join(worktree, "node_modules"))) {
    log("  installing dependencies in the worktree...");
    const install = await installDeps(worktree, log);
    if (!install.ok) {
      log(`  install failed:\n${install.output.split(/\r?\n/).slice(-8).join("\n")}`);
      state.items[itemId] = { status: "blocked", reason: "pnpm install failed in worktree" };
      return { itemId, status: "blocked" };
    }
  }

  const implementer = await spawnAgent(agentName("plan", itemId), worktree, ctx.parent);
  log(`  implementer: ${implementer.address}`);

  let lastFailures = [];
  let result = { status: "blocked" };

  for (let attempt = 1; attempt <= args.attempts; attempt++) {
    const template = fs.readFileSync(
      path.join(BRIEFS, attempt === 1 ? "implement.md" : "fix.md"),
      "utf8",
    );
    const vars = {
      ITEM_ID: itemId,
      SECTION: item.section,
      ITEM_TEXT: item.text,
      WORKTREE: worktree,
      PACKAGE_ROOT: packageRoot,
      ALLOWED_PATHS: allowed,
      GATE_COMMANDS: gateText,
      CHECKLIST_PATH: checklistRel,
      FAILURES: lastFailures
        .map((f) => `- [${f.gate}] ${f.detail}`)
        .join("\n") || "(no failures recorded)",
    };
    const brief = renderBrief(template, vars);
    const briefFile = path.join(briefDir, attempt === 1 ? "implement.md" : "fix.md");
    fs.writeFileSync(briefFile, brief, "utf8");

    log(`  attempt ${attempt}: briefing implementer`);
    const pointer =
      `Read the brief at "${briefFile}" and execute it exactly. ` +
      `Checklist item ${itemId}: ${item.text}. ` +
      `Work only inside ${worktree}.`;
    const screen = await sendAndWait(implementer.address, pointer, {
      timeout: args.turnTimeout,
    });
    const report = parseReport(screen);

    if (report.status === "blocked") {
      lastFailures = [{ gate: "worker", detail: `worker reported blocked: ${report.blocked}` }];
      log(`  worker reported blocked: ${report.blocked}`);
      continue;
    }

    log("  running mechanical gates...");
    const gateResult = await runGates({
      worktree, base, item, packageRoot, checklistRel, gates,
      baseline: ctx.baseline, onLog: log,
    });
    lastFailures = gateResult.failures;
    if (lastFailures.length) {
      log(`  gates failed: ${lastFailures.map((f) => f.gate).join(", ")}`);
      continue;
    }
    log("  gates passed");

    // squash the worker's work into one commit on the item branch
    await git(["add", "-A"], worktree);
    await git(["reset", "--soft", base], worktree);
    await git(
      ["commit", "-m", `plan(${itemId}): ${item.text.slice(0, 72)}`],
      worktree,
      120_000,
    );
    const head = (await git(["rev-parse", "HEAD"], worktree)).stdout.trim();

    // independent review
    log("  spawning independent reviewer");
    const reviewer = await spawnAgent(agentName("review", itemId), worktree, ctx.parent);
    const reviewVars = {
      ITEM_ID: itemId,
      SECTION: item.section,
      ITEM_TEXT: item.text,
      WORKTREE: worktree,
      BASE_SHA: base,
      HEAD_SHA: head,
    };
    const reviewBrief = renderBrief(
      fs.readFileSync(path.join(BRIEFS, "review.md"), "utf8"),
      reviewVars,
    );
    const reviewFile = path.join(briefDir, "review.md");
    fs.writeFileSync(reviewFile, reviewBrief, "utf8");
    const reviewScreen = await sendAndWait(
      reviewer.address,
      `Read the review brief at "${reviewFile}" and execute it exactly. Review the diff for item ${itemId}.`,
      { timeout: args.turnTimeout },
    );
    const verdict = parseReport(reviewScreen);
    await hc(["kill", reviewer.address]);
    await hc(["rm", reviewer.address]);

    if (verdict.verdict !== "PASS") {
      lastFailures = [
        {
          gate: "review",
          detail: `independent reviewer returned ${verdict.verdict ?? "NO VERDICT"}: ${verdict.reasons ?? "(no reasons given)"}`,
        },
      ];
      log(`  review failed: ${lastFailures[0].detail.slice(0, 160)}`);
      // let the implementer try again from the committed state
      await git(["reset", "--hard", head], worktree);
      continue;
    }
    log("  review PASSED");

    result = {
      itemId,
      status: "ready",
      worktree,
      branch,
      head,
      changed: gateResult.changed,
      commandResults: gateResult.commandResults,
      reviewer: reviewer.address,
      implementer: implementer.address,
    };
    break;
  }

  if (result.status !== "ready") {
    await hc(["kill", implementer.address]);
    state.items[itemId] = {
      status: "blocked",
      failures: lastFailures,
      worktree,
      branch,
    };
    if (!args.keepBlocked) await removeWorktree(worktree, branch);
    return { itemId, status: "blocked", failures: lastFailures };
  }

  await hc(["kill", result.implementer]);
  state.items[itemId] = { status: "ready", ...result };
  return result;
}

// ---------------------------------------------------------------------------
// merge + evidence
// ---------------------------------------------------------------------------

async function mergeItem(result, ctx) {
  const { base, log, checklistAbs, checklistRel, item, planId } = ctx;
  const baseSha = (await git(["rev-parse", base])).stdout.trim();

  // rebase onto the current base (other items may have merged first)
  const rebase = await git(["rebase", baseSha], result.worktree, 300_000);
  if (rebase.code !== 0) {
    await git(["rebase", "--abort"], result.worktree);
    log(`  rebase conflict -> item blocked`);
    return { ok: false, reason: "rebase conflict" };
  }

  // re-run the commands after the rebase
  for (const cmd of ctx.gates) {
    const r = await execCmd(cmd, { cwd: result.worktree, timeout: 1_200_000 });
    if (r.code !== 0) {
      log(`  post-rebase gate failed: ${cmd}`);
      return { ok: false, reason: `post-rebase gate failed: ${cmd}` };
    }
  }

  const merge = await git(["merge", "--ff-only", result.branch], REPO_ROOT, 120_000);
  if (merge.code !== 0) {
    log(`  merge failed: ${merge.stdout}${merge.stderr}`);
    return { ok: false, reason: "merge failed" };
  }

  // the orchestrator owns the checklist and the evidence log
  const lines = fs.readFileSync(checklistAbs, "utf8").split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(item.text.slice(0, 60)));
  if (idx >= 0) {
    lines[idx] = lines[idx].replace(/^- \[( |~)\]/, "- [x]");
  }
  const evidenceIdx = lines.findIndex((l) => /^#{1,6}\s+evidence log/i.test(l));
  const summary = result.commandResults
    .map((c) => `${c.cmd} => exit ${c.code}`)
    .join("; ");
  const diffStat = result.changed.length;
  const entry =
    `- ${new Date().toISOString().slice(0, 10)} — ${item.id}: ${item.text.slice(0, 90)} ` +
    `(${summary}; ${diffStat} file(s) changed; independent review: PASS).`;
  if (evidenceIdx >= 0) lines.splice(evidenceIdx + 1, 0, entry);
  fs.writeFileSync(checklistAbs, lines.join("\n"), "utf8");
  await git(["add", checklistRel], REPO_ROOT);
  await git(
    ["commit", "-m", `docs(checklist): mark ${item.id} complete`],
    REPO_ROOT,
    120_000,
  );

  await removeWorktree(result.worktree, result.branch);
  log(`  merged and recorded: ${item.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.checklist) {
    console.log(USAGE);
    process.exit(args.checklist ? 0 : 1);
  }

  const checklistAbs = path.resolve(REPO_ROOT, args.checklist);
  if (!fs.existsSync(checklistAbs)) {
    console.error(`checklist not found: ${checklistAbs}`);
    process.exit(1);
  }
  const checklistRel = path.relative(REPO_ROOT, checklistAbs).replace(/\\/g, "/");
  const packageRoot = args.pkg
    ? path.resolve(REPO_ROOT, args.pkg)
    : path.resolve(path.dirname(checklistAbs));

  const { items, evidenceHeading } = parseChecklist(checklistAbs);
  const selected = items.filter((i) => {
    if (args.only.length) return args.only.includes(i.id);
    if (i.state === "done") return false;
    if (i.state === "partial" && !args.includePartial) return false;
    return true;
  });

  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  const pkgName = pkgJson.name;
  const gates = args.gates ?? [
    `pnpm --filter ${pkgName} run typecheck`,
    `pnpm --filter ${pkgName} run lint`,
    pkgJson.scripts?.["test:all"]
      ? `pnpm --filter ${pkgName} run test:all`
      : `pnpm --filter ${pkgName} run test`,
  ];

  const planId =
    args.planId ?? `plan-${slug(path.basename(path.dirname(checklistAbs)))}`;
  const worktreeRoot = path.join(os.homedir(), ".herdr", "plan", planId);
  const stateDir = path.join(REPO_ROOT, ".planning", "plan-executor", planId);
  fs.mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, "state.json");
  const baselineFile = path.join(stateDir, "baseline.json");
  const baseline = fs.existsSync(baselineFile)
    ? JSON.parse(fs.readFileSync(baselineFile, "utf8"))
    : null;
  const state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf8"))
    : { planId, checklist: checklistRel, base: args.base, items: {} };
  const ledgerFile = path.join(stateDir, "ledger.jsonl");

  const log = (msg) => {
    console.log(msg);
    fs.appendFileSync(
      ledgerFile,
      JSON.stringify({ ts: new Date().toISOString(), msg }) + "\n",
      "utf8",
    );
  };

  console.log(`checklist : ${checklistRel}`);
  console.log(`package   : ${pkgName} (${packageRoot})`);
  console.log(`base      : ${args.base}`);
  console.log(`gates     : ${gates.join(" | ")}`);
  console.log(`items     : ${selected.length} open of ${items.length} total`);
  console.log(`evidence  : ${evidenceHeading >= 0 ? `line ${evidenceHeading + 1}` : "NOT FOUND"}`);
  console.log("");
  for (const item of selected.slice(0, args.maxItems)) {
    console.log(
      `  ${item.id}  [${item.state}]  ${item.section} :: ${item.text.slice(0, 96)}`,
    );
  }

  if (args.dryRun) {
    console.log("\n(dry run - nothing changed)");
    return;
  }

  if (args.recordBaseline) {
    console.log(`\nrecording baseline for ${gates.length} gate command(s)...`);
    const commands = {};
    for (const cmd of gates) {
      const r = await execCmd(cmd, { cwd: REPO_ROOT, timeout: 1_200_000 });
      const failures = collectFailures(`${r.stdout}\n${r.stderr}`);
      commands[cmd] = failures;
      console.log(
        `  ${failures.length ? "FAIL" : "OK  "} ${cmd} (exit ${r.code}, ${failures.length} failing test(s))`,
      );
      for (const f of failures) console.log(`        ${f}`);
    }
    const payload = {
      recordedAt: new Date().toISOString(),
      base: args.base,
      commands,
    };
    fs.writeFileSync(baselineFile, JSON.stringify(payload, null, 2), "utf8");
    console.log(`\nbaseline written: ${baselineFile}`);
    return;
  }

  const baseSha = (await git(["rev-parse", args.base])).stdout.trim();
  const ctx = {
    args, base: baseSha, packageRoot, checklistRel, checklistAbs, gates, state,
    stateDir, ledgerFile, worktreeRoot, planId, baseline, log,
    parent: args.parent,
  };

  // implementation phase, N items at a time
  const queue = selected.slice(0, args.maxItems);
  const results = [];
  const concurrency = Math.max(1, args.workers);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= queue.length) return;
      const item = queue[index];
      log(`\n=== ${item.id} (${item.state}) ${item.section} ===`);
      const r = await runItem(item, ctx);
      results.push({ item, ...r });
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // merge phase, in checklist order, one at a time
  log("\n=== merge phase ===");
  for (const entry of results) {
    if (entry.status !== "ready") {
      log(`${entry.itemId}: blocked, left in place for inspection`);
      continue;
    }
    ctx.item = entry.item;
    const m = await mergeItem(entry, ctx);
    state.items[entry.itemId] = {
      ...state.items[entry.itemId],
      status: m.ok ? "done" : "blocked",
      merge: m.reason ?? null,
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
  }

  const done = Object.values(state.items).filter((s) => s.status === "done").length;
  const blocked = Object.values(state.items).filter((s) => s.status === "blocked").length;
  log(`\nsummary: ${done} merged, ${blocked} blocked`);
  log(`state:   ${stateFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
