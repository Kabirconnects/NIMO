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
    scope: [],
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
    else if (a === "--merge-only") out.mergeOnly = true;
    else if (a === "--record-baseline") out.recordBaseline = true;
    else if (a === "--parent") out.parent = next();
    else if (a === "--scope") out.scope = next().split(",").map((s) => s.trim()).filter(Boolean);
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
  --scope <a,b>          packages an item may touch (default: the checklist's package)
  --workers <n>          items implemented in parallel (default: 2)
  --attempts <n>         implement attempts per item before giving up (default: 3)
  --only <id,id>         run only these item ids
  --max-items <n>        stop after n items
  --gates "<cmd;cmd>"    override gate commands
  --turn-timeout <sec>   max wait per agent turn (default: 1800)
  --open-only            only items marked [ ] (skip [~] partial ones)
  --drop-blocked         delete worktrees of blocked items (default: keep them)
  --merge-only           merge items that already passed every gate and the
                         reviewer, without spawning a worker (recovery path)
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

  const headingOf = (line) => /^#{1,6}\s+(.*)$/.exec(line);
  const itemOf = (line) => /^\s*-\s*\[( |x|~)\]\s+(.*)$/.exec(line);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = headingOf(line);
    if (heading) {
      const title = heading[1].trim();
      if (/^evidence log/i.test(title)) evidenceHeading = index;
      if (/^#{2,3}\s/.test(line)) section = title;
      continue;
    }
    const match = itemOf(line);
    if (!match) continue;

    // A checklist item can span several lines: the first line carries the
    // statement, the indented lines below it carry the detail. Only the
    // first line was used before, so a multi-line item reached the worker
    // (and the independent reviewer) as a sentence cut in half - and both
    // of them were judging the same fragment.
    const head = match[2].trim();
    const parts = [head];
    let j = index + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (!next.trim()) {
        // A blank line only continues the item when an indented line follows.
        let k = j;
        while (k < lines.length && !lines[k].trim()) k++;
        const follows =
          k < lines.length &&
          /^\s+/.test(lines[k]) &&
          !itemOf(lines[k]) &&
          !headingOf(lines[k]);
        if (!follows) break;
        j = k;
        continue;
      }
      if (headingOf(next) || itemOf(next)) break;
      if (!/^\s+/.test(next)) break;
      parts.push(next.trim());
      j++;
    }

    const n = (sectionCounts.get(section) ?? 0) + 1;
    sectionCounts.set(section, n);
    items.push({
      id: `${slug(section)}-${String(n).padStart(2, "0")}`,
      state: match[1] === " " ? "open" : match[1] === "~" ? "partial" : "done",
      // The whole item, on one line: the brief, the review and the evidence
      // entry all use it.
      text: parts.join(" ").replace(/\s+/g, " ").trim(),
      // The first line only: used to find the item's line in the file again.
      head,
      line: index + 1,
      section,
      raw: line,
    });
    index = j - 1;
  }

  return { raw, lines, items, evidenceHeading };
}

/**
 * Paths named by the item, e.g. `src/storage/db.ts`, as repo-relative paths.
 *
 * The item text mixes two kinds of path: repo-relative ones (`apps/server`)
 * and package-relative ones (`src/storage/db.ts`). Both have to be resolved
 * against the repo, or a path like `apps/server` ends up pointing at
 * `<checklist's package>/apps/server` - a directory that does not exist.
 *
 * Only paths that exist (or whose directory exists, for a file to be created)
 * are returned: the text also contains things like `tsx scripts/<name>-test.ts`
 * and `echo 'no tests' && exit 0`, which are not paths at all.
 */
function itemPaths(item, packageRoot, repoRoot) {
  const found = new Set();
  const candidates = [];
  for (const m of item.text.matchAll(/`([^`]+)`/g)) candidates.push(m[1]);
  for (const m of item.text.matchAll(/\b((?:src|scripts|test|tests)\/[\w./*-]+)/g))
    candidates.push(m[1]);
  const pkgRel = path.relative(repoRoot, packageRoot).replace(/\\/g, "/");
  for (const raw of candidates) {
    const token = raw.trim().replace(/[.,;)]+$/, "");
    if (!token || token.length > 120) continue;
    if (!/[/\\]|\.(ts|tsx|js|json|md)$/.test(token)) continue;
    if (/^https?:/i.test(token)) continue;
    const normalized = token.replace(/\\/g, "/");
    // A path inside a package is package-relative; anything else is
    // repo-relative.
    const repoRel = /^(src|scripts|test|tests)\//.test(normalized)
      ? path.posix.join(pkgRel, normalized)
      : normalized;
    const abs = path.join(repoRoot, repoRel);
    const dir = path.dirname(abs);
    if (!fs.existsSync(abs) && !fs.existsSync(dir)) continue;
    found.add(repoRel);
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
  // The repo has more than one convention: the memory suite prints
  // "FAIL <name>", the test scripts S0 introduced print "<cross mark> <name>".
  // A collector that only knows one of them reports a real test failure as
  // "the command died without naming a failure" - which is how a proof that
  // had already succeeded was reported as inconclusive.
  const patterns = [
    /^\s*FAIL\s+(.+?)\s*$/,
    /^\s*[✗✘✕❌]\s*(.+?)\s*$/,
    /^\s*not ok\s+\d*\s*-?\s*(.+?)\s*$/i,
  ];
  for (const line of output.split(/\r?\n/)) {
    for (const re of patterns) {
      const m = re.exec(line);
      if (m) {
        const name = m[1].trim();
        if (name) found.add(name);
        break;
      }
    }
  }
  return [...found];
}

/**
 * The test commands that actually exercise the packages an item changed.
 *
 * The proof has to run the tests of the package that was changed. Running the
 * first test command in the gate list proves nothing when the item lives in a
 * different package: S4 (packages/agents) was "proved" by the server's suite,
 * which never imports the agents package - so the old code passed and the
 * proof gate failed for the wrong reason, pointing the worker at the wrong
 * command.
 */
function proofCommandsFor(sourceChanged, gates, root) {
  const testCmds = gates.filter((g) => /\btest\b/i.test(g));
  const names = new Set();
  for (const file of sourceChanged) {
    let dir = path.dirname(file);
    while (dir && dir !== "." && dir !== path.sep) {
      const pkg = path.join(root, dir, "package.json");
      if (fs.existsSync(pkg)) {
        try {
          const name = JSON.parse(fs.readFileSync(pkg, "utf8")).name;
          if (name) names.add(name);
        } catch {
          /* an unreadable package.json gives us no name to match */
        }
        break;
      }
      dir = path.dirname(dir);
    }
  }

  const cmds = [];
  const uncovered = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = testCmds.filter((c) =>
      new RegExp(`--filter[ =]${escaped}(?:\\s|$)`).test(c),
    );
    if (matches.length) cmds.push(...matches);
    else uncovered.push(name);
  }
  return { cmds: [...new Set(cmds)], uncovered, testCmds };
}

/**
 * Proof gate: the new tests must fail against the pre-change source.
 *
 * A test that passes before and after the change proves nothing. This is the
 * one check a reviewer cannot be trusted with - it is mechanical. The source
 * files the item changed are rolled back to the base version, the tests are
 * left as the worker wrote them, and the test suite is run again. If it is
 * still green, the tests do not demonstrate the change and the item fails.
 *
 * Items that only add tests (no source change) are exempt: there is no
 * "before" behaviour for them to contradict.
 */
async function checkTestsProveTheChange({ worktree, base, sourceChanged, gates, baseline, onLog }) {
  const { cmds, uncovered, testCmds } = proofCommandsFor(sourceChanged, gates, worktree);
  if (!sourceChanged.length || !testCmds.length) return null;
  if (!cmds.length) {
    return {
      gate: "proof",
      detail:
        `no gate command runs the tests of the package this item changed ` +
        `(${uncovered.join(", ") || sourceChanged.join(", ")}), so the change cannot be proved. ` +
        `Add that package's test command to the gates.`,
    };
  }

  onLog?.(
    `    proof: re-running the tests against the pre-change source ` +
    `(${cmds.join(", ")})`,
  );

  // Back up the worker's source files, so they can be restored exactly.
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), "plan-executor-proof-"));
  const files = sourceChanged.map((rel) => {
    const abs = path.join(worktree, rel);
    const dest = path.join(backup, rel.replace(/[\\/]/g, "__"));
    fs.copyFileSync(abs, dest);
    return { rel, abs, dest };
  });
  const beforeDiff = (await git(["diff", base, "--", ...sourceChanged], worktree)).stdout;

  try {
    // Put the base version of every changed source file back. A file the fix
    // *created* has no base version, so it has to be removed - and a single
    // `git checkout base -- <paths>` would fail on it and restore nothing.
    for (const rel of sourceChanged) {
      const existed = await git(["cat-file", "-e", `${base}:${rel}`], worktree);
      if (existed.code === 0) {
        await git(["checkout", base, "--", rel], worktree);
      } else {
        fs.rmSync(path.join(worktree, rel), { force: true });
      }
    }
    const stillGreen = [];
    for (const cmd of cmds) {
      const r = await execCmd(cmd, { cwd: worktree, timeout: 1_200_000 });
      const output = `${r.stdout}\n${r.stderr}`;
      const currentFailures = collectFailures(output);
      const known = baseline?.commands?.[cmd] ?? [];
      const newFailures = currentFailures.filter((f) => !known.includes(f));

      if (r.code === 0) {
        stillGreen.push({ cmd, output });
        continue;
      }
      if (!currentFailures.length) {
        // The command died without naming a failing test. There are two very
        // different reasons, and they are not equally strong:
        //
        //  - the test imports a module the old code does not have (the fix
        //    added a file). The test pins the new code: it cannot load
        //    without it. That IS a proof - the test is sensitive to the
        //    change by construction.
        //  - the old source itself crashes when loaded (it reads
        //    `import.meta.env`, say). The test never ran, so it demonstrated
        //    nothing. That is inconclusive.
        if (/ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/i.test(output)) {
          onLog?.(
            `    proof: the test requires the new code to exist ` +
            `(it cannot load without it)`,
          );
          return {
            ok: true,
            detail: `the test cannot load without the change (it imports a module the old code does not have), so it pins the new code`,
          };
        }
        onLog?.(
          `    proof: inconclusive - the suite could not run against the old source ` +
          `(no named test failure, probably a compile error)`,
        );
        return {
          gate: "proof",
          detail:
            `the proof of this change is inconclusive: with the pre-change source in ` +
            `place, \`${cmd}\` failed without reporting a named test failure (it could ` +
            `not compile or load against the old source), so the tests do not ` +
            `demonstrate the behaviour they are supposed to. Write the test so it ` +
            `runs against both versions and fails on the old one.`,
        };
      }
      if (known.length && !newFailures.length) {
        return {
          gate: "proof",
          detail:
            `the tests do not prove this change: with the pre-change source in place, ` +
            `\`${cmd}\` failed only for reasons that already failed at baseline.`,
        };
      }
      onLog?.(
        `    proof: the tests fail without the change (${newFailures.length} new failure(s))`,
      );
      return {
        ok: true,
        detail: `${newFailures.length} named failure(s) without the change: ${newFailures.slice(0, 3).join(" | ")}`,
      };
    }

    // Every command still passed against the old source: the tests do not
    // detect the change. Show the worker what actually ran, so it can see
    // which assertion passed on the old code.
    const detail =
      `the tests still pass against the pre-change source, so they do not prove ` +
      `this change: ` +
      stillGreen.map((p) => `\`${p.cmd}\` exited 0 with the old ${sourceChanged.join(", ")} in place.`).join(" ") +
      ` The assertion that should have failed passed on the old code - the test ` +
      `does not exercise the behaviour this item changed. Output tail:\n` +
      stillGreen.map((p) => p.output.trim().split(/\r?\n/).slice(-12).join("\n")).join("\n");
    return { gate: "proof", detail };
  } finally {
    // Put the worker's source back, byte for byte.
    for (const f of files) fs.copyFileSync(f.dest, f.abs);
    fs.rmSync(backup, { recursive: true, force: true, maxRetries: 5 });
    const afterDiff = (await git(["diff", base, "--", ...sourceChanged], worktree)).stdout;
    if (afterDiff !== beforeDiff) {
      onLog?.(`    proof: WARNING - the source files were not restored exactly`);
    }
  }
}

/**
 * Allow-list the packages pnpm refused to build, in the worktree's
 * pnpm-workspace.yaml.
 *
 * `value` is `true` to let the package build, `false` to skip its build script
 * explicitly. The latter is what pnpm wants when a package ships a prebuilt
 * binary: the script is not needed, and saying "false" stops pnpm from failing
 * the whole install with ERR_PNPM_IGNORED_BUILDS.
 *
 * The edit is surgical on purpose: rewriting the file would normalise its line
 * endings and turn a one-line change into a whole-file diff, which then
 * conflicts with the base branch on every rebase. The file is left patched
 * because pnpm re-runs its install check before every script; `restoreHarnessPatches`
 * undoes it before anything is committed.
 */
function allowBuildsInWorktree(worktree, output, value = "true") {
  const ignored = /Ignored build scripts:\s*(.+)/i.exec(output);
  if (!ignored) return null;
  const names = [
    ...new Set(
      ignored[1]
        .split(",")
        .map((s) => s.trim().split("@")[0].trim())
        .filter(Boolean),
    ),
  ];
  const wsFile = path.join(worktree, "pnpm-workspace.yaml");
  if (!fs.existsSync(wsFile)) return null;
  let text = fs.readFileSync(wsFile, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  // Update entries that already exist, add the ones that do not.
  const missing = [];
  for (const name of names) {
    const existing = new RegExp(`^(\\s*)${name}:\\s*\\S+`, "m");
    if (existing.test(text)) {
      text = text.replace(existing, `$1${name}: ${value}`);
    } else {
      missing.push(name);
    }
  }
  if (missing.length) {
    const add = missing.map((n) => `  ${n}: ${value}`).join(eol);
    text = /allowBuilds:\r?\n/.test(text)
      ? text.replace(/allowBuilds:\r?\n/, `allowBuilds:${eol}${add}${eol}`)
      : `${text.replace(/\s*$/, "")}${eol}${eol}allowBuilds:${eol}${add}${eol}`;
  }
  fs.writeFileSync(wsFile, text, "utf8");
  return "pnpm-workspace.yaml";
}

/**
 * The harness patches files for its own reasons (pnpm's build policy). Those
 * files are tracked here so they can be restored before anything is committed -
 * an environment fix must never end up in an item's diff.
 */
function patchRecordFile(stateDir) {
  return path.join(stateDir, "harness-patched.json");
}

function readPatchRecord(stateDir) {
  const file = patchRecordFile(stateDir);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function recordHarnessPatch(stateDir, worktree, file) {
  const record = readPatchRecord(stateDir);
  const list = new Set(record[worktree] ?? []);
  list.add(file);
  record[worktree] = [...list];
  fs.writeFileSync(patchRecordFile(stateDir), JSON.stringify(record, null, 2), "utf8");
}

async function restoreHarnessPatches(stateDir, worktree, log) {
  const record = readPatchRecord(stateDir);
  const files = record[worktree] ?? [];
  for (const file of files) {
    // restore from the index (which still holds the pre-patch content)
    await git(["checkout", "--", file], worktree);
    log?.(`    restored the harness's own change to ${file}`);
  }
  if (files.length) {
    delete record[worktree];
    fs.writeFileSync(patchRecordFile(stateDir), JSON.stringify(record, null, 2), "utf8");
  }
}

/**
 * Install dependencies in a worktree.
 *
 * pnpm refuses to run dependency build scripts unless they are allow-listed, and
 * it exits non-zero when it ignores one - which breaks every fresh worktree for a
 * repo that has a native dependency. Self-heal: allow the ignored packages, retry.
 *
 * Returns the list of tracked files the harness patched, so the caller can keep
 * them out of the item's commit.
 */
async function installDeps(worktree, log, stateDir) {
  // `--frozen-lockfile` is the default: a stale lockfile is a real problem and
  // should be caught. But an item may legitimately add a dependency (the S0
  // prerequisite in the security plan does), and then the lockfile *must*
  // change. Retry without the freeze only for that specific error, and report
  // it so the lockfile change is visible in the notes and the review diff.
  let frozen = true;
  const run = () =>
    execCmd(
      `pnpm install ${frozen ? "--frozen-lockfile " : ""}--prefer-offline`,
      { cwd: worktree, timeout: 1_800_000 },
    );
  let r = await run();
  if (
    r.code !== 0 &&
    /ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile/i.test(`${r.stdout}\n${r.stderr}`)
  ) {
    log("    the lockfile is out of date (the item adds a dependency) - updating it");
    frozen = false;
    r = await run();
  }
  const lockfileUpdated = !frozen;
  if (r.code === 0) return { ok: true, patched: [], lockfileUpdated };
  const output = `${r.stdout}\n${r.stderr}`;

  // First try letting the package build. If its build script fails (no local
  // toolchain), fall back to skipping it: many native packages ship a prebuilt
  // binary, and skipping is better than failing every install.
  let patchedFile = allowBuildsInWorktree(worktree, output, "true");
  if (patchedFile) {
    log("    install blocked by pnpm's build policy - allowing the build and retrying");
    if (stateDir) recordHarnessPatch(stateDir, worktree, patchedFile);
    r = await run();
    if (r.code === 0) return { ok: true, patched: [patchedFile], lockfileUpdated };
  }

  // The build itself failed: skip the build script instead.
  const retryOutput = `${r.stdout}\n${r.stderr}`;
  patchedFile =
    allowBuildsInWorktree(worktree, retryOutput, "false") ??
    patchedFile ??
    allowBuildsInWorktree(worktree, output, "false");
  if (!patchedFile) return { ok: false, output, patched: [], lockfileUpdated };
  log("    the build script failed - skipping it and retrying");
  if (stateDir) recordHarnessPatch(stateDir, worktree, patchedFile);
  r = await run();
  return {
    ok: r.code === 0,
    output: `${r.stdout}\n${r.stderr}`,
    patched: [patchedFile],
    lockfileUpdated,
  };
}

async function runGates({
  worktree, base, item, packageRoot, scopeRels, checklistRel, gates, baseline, onLog,
  stateDir,
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

  // scope: stay inside the scoped packages, never touch the checklist, bounded files
  const pkgRel = scopeRels?.[0] ?? path.relative(REPO_ROOT, packageRoot).replace(/\\/g, "/");
  const scopeSet = new Set(scopeRels?.length ? scopeRels : [pkgRel]);
  const ROOT_CONFIG_ALLOW = new Set([
    "pnpm-workspace.yaml", "package.json", "pnpm-lock.yaml", "turbo.json",
    "tsconfig.json", ".npmrc",
  ]);
  const inScope = (f) =>
    [...scopeSet].some((s) => f === s || f.startsWith(s + "/"));
  const outside = allFiles.filter(
    (f) => !inScope(f) && !ROOT_CONFIG_ALLOW.has(f),
  );
  if (outside.length) {
    failures.push({
      gate: "scope",
      detail: `changed files outside the scoped packages (${[...scopeSet].join(", ")}): ${outside.join(", ")}. Remove stray files or move the change inside the scope.`,
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
  // pnpm re-checks its install state before every script; if the worktree is
  // not installable every command fails for a reason that has nothing to do
  // with the item. Make it installable first.
  const install = await installDeps(worktree, onLog ?? (() => {}), stateDir);
  if (!install.ok) {
    failures.push({
      gate: "command",
      detail: `the worktree cannot be installed, so no command can be trusted:\n${install.output.split(/\r?\n/).slice(-8).join("\n")}`,
    });
    return { failures, changed: allFiles, notes, commandResults: [] };
  }
  if (install.lockfileUpdated) {
    notes.push("pnpm-lock.yaml was updated to install a new dependency (must be justified)");
  }

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
      } else if (!currentFailures.length) {
        // The command died without reporting any named failure - a crash, a
        // compile error, a missing binary. That is never a "known" failure,
        // however full the baseline is.
        failures.push({
          gate: "command",
          detail:
            `\`${cmd}\` exited ${r.code} without reporting a test failure ` +
            `(it crashed or could not compile). Output tail:\n${tail}`,
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

  // the tests must actually demonstrate the change
  const proof = await checkTestsProveTheChange({
    worktree, base, sourceChanged, gates, baseline, onLog,
  });
  if (proof?.gate) failures.push(proof);
  const proofDetail = proof?.ok ? proof.detail : null;
  if (proofDetail) notes.push(`proof: ${proofDetail}`);

  return { failures, changed, notes, commandResults: results, proofDetail };
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

/**
 * Wait until the agent's UI is actually at a prompt.
 *
 * `hc run --bg` returns as soon as the terminal exists, but the agent still has
 * to boot. A prompt sent during that window is either dropped or answered
 * before the agent is ready, and the turn looks like it finished immediately
 * with no output - which is how a reviewer ends up reporting "NO VERDICT".
 *
 * The readiness marker is the status line at the very bottom of the screen
 * ("auto mode on ... shift+tab to cycle"), because that line is only painted
 * once the TUI is fully up. Matching anywhere on the screen is too early: the
 * welcome banner contains a "❯" of its own.
 */
async function waitForAgentReady(address, { timeout = 120_000 } = {}) {
  const deadline = Date.now() + timeout;
  let dismissed = 0;
  while (Date.now() < deadline) {
    const status = await agentStatus(address);
    const state = status?.status?.state ?? status?.state ?? "unknown";
    const screen = await readScreen(address);
    if (/Enter to continue/i.test(screen) && dismissed < 3) {
      dismissed++;
      await hc(["keys", address, "enter"]);
      await sleep(1000);
      continue;
    }
    const bottom = screen
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-6)
      .join("\n");
    const ready =
      /auto mode on|shift\+tab to cycle|Waiting for your input/i.test(bottom) ||
      /^\s*❯\s*$/m.test(bottom);
    if (state !== "working" && ready) return true;
    await sleep(2000);
  }
  return false;
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
  await waitForAgentReady(parsed.address);
  return parsed;
}

async function readScreen(address) {
  const r = await hc(["read", address]);
  return r.stdout;
}

/**
 * A modal that is waiting for a keypress, and the key that dismisses it.
 *
 * Claude Code interrupts the turn to ask for a decision. The one that bit us
 * is the plan approval: the worker wrote a plan, asked "Would you like to
 * proceed?", and sat there until the attempt timed out. The worktree stayed
 * empty, so the item failed the diff gate three times with no explanation -
 * the harness never even mentioned the modal.
 */
function detectModal(screen) {
  // Only the bottom of the screen counts: the agent may quote the phrase in
  // its own output, but a real modal is painted right above the prompt.
  const tail = screen.split(/\r?\n/).slice(-30).join("\n");
  if (/written up a plan and is ready to execute|Would you like to proceed\?/i.test(tail)) {
    // Option 1 is "Yes, and use auto mode" and is selected by default, so a
    // plain enter approves the plan and lets the worker execute it.
    return { kind: "plan-approval", keys: ["enter"] };
  }
  if (/Enter to continue/i.test(tail)) return { kind: "enter-continue", keys: ["enter"] };
  if (/waiting for your input|press enter/i.test(tail)) return { kind: "waiting-input", keys: ["enter"] };
  // A permission prompt: "Allow this read outside the working directories?
  // <cursor> 1. Yes, ...". Option 1 is the permissive one in every prompt
  // Claude Code shows here, so enter accepts it.
  if (/^\s*❯\s*1\.\s*Yes/im.test(tail) && /allow|approve|proceed|permission/i.test(tail)) {
    return { kind: "permission-prompt", keys: ["enter"] };
  }
  return null;
}

async function dismissModal(address, modal) {
  for (const key of modal.keys) {
    await hc(["keys", address, key]);
    await sleep(300);
  }
  return `dismissed a ${modal.kind} modal`;
}

async function unstick(address) {
  const screen = await readScreen(address);
  const modal = detectModal(screen);
  if (!modal) return null;
  return dismissModal(address, modal);
}

/** Is the report trailer visible near the end of the screen? */
function hasTrailer(screen, regex) {
  const lines = screen.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return regex.test(lines.slice(-25).join("\n"));
}

/**
 * The part of the screen that belongs to the current turn.
 *
 * The terminal scrolls, so the previous turn's report trailer is often still
 * visible near the bottom when the next prompt is sent. Reading it as the new
 * turn's answer makes the harness give up while the worker is still working —
 * which is how a worker ends up "retrying" without ever seeing the failure it
 * was given. The echoed prompt marks where this turn starts.
 */
function screenSincePrompt(screen, marker) {
  if (!marker) return screen;
  const idx = screen.lastIndexOf(marker);
  return idx >= 0 ? screen.slice(idx) : screen;
}

/**
 * Send a prompt and wait for that turn to end. Returns the screen text afterwards.
 *
 * `done` is a regex for the report trailer. The trailer is the reliable signal
 * that the agent finished its work: the agent's "working" state can flicker, and
 * a fresh agent can look idle before it has even picked up the prompt.
 */
async function sendAndWait(address, text, { timeout = 1800, done = null } = {}) {
  await hc(["send", address, text, "--json"]);
  const deadline = Date.now() + timeout * 1000;
  // A freshly spawned agent can report "idle" for a moment before it starts.
  const startDeadline = Date.now() + 30_000;
  // A short, stable prefix of the prompt: it is echoed on screen when the
  // agent receives it, and it marks the start of this turn. Kept short so the
  // terminal cannot wrap it.
  const marker = text.slice(0, 16).trim();
  let sawWorking = false;
  let resent = false;
  let unsticks = 0;
  for (;;) {
    const status = await agentStatus(address);
    const state = status?.status?.state ?? status?.state ?? "unknown";
    if (state === "working") sawWorking = true;

    const screen = await readScreen(address);
    const current = screenSincePrompt(screen, marker);
    if (done && hasTrailer(current, done)) return current;

    // A modal does not always show up as a "blocked" state: the plan-approval
    // prompt leaves the agent idle and waiting, so the worker would sit there
    // until the attempt timed out. Look for a modal on every poll.
    const modal = detectModal(current);
    if (modal && unsticks < 5) {
      unsticks++;
      await dismissModal(address, modal);
      await sleep(1500);
      continue;
    }

    if (state === "blocked" && unsticks < 2) {
      unsticks++;
      const what = await unstick(address);
      if (what) {
        await sleep(1500);
        continue;
      }
    }

    if (state !== "working" && (sawWorking || Date.now() > startDeadline)) {
      // The turn is over. Re-read once, in case the final message was still
      // being painted when the state flipped.
      await sleep(1500);
      const again = screenSincePrompt(await readScreen(address), marker);
      if (done && hasTrailer(again, done)) return again;
      return again;
    }

    // The agent never picked the prompt up (it was sent too early). Send it
    // again rather than waiting for a turn that will never happen.
    if (!sawWorking && !resent && Date.now() > startDeadline + 15_000) {
      resent = true;
      await hc(["send", address, text, "--json"]);
      startDeadline = Date.now() + 30_000;
      continue;
    }

    if (Date.now() > deadline) return screenSincePrompt(await readScreen(address), marker);
    await sleep(3000);
  }
}

function parseReport(screen) {
  const lines = screen.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-120);
  const joined = tail.join("\n");
  // Return the capture group of the last match, so "VERDICT: PASS" yields
  // "PASS" and not the second character of the matched text.
  const last = (re) => {
    const matches = [...joined.matchAll(re)];
    if (!matches.length) return null;
    const m = matches[matches.length - 1];
    return m.length > 1 ? m[1] : m[0];
  };
  return {
    status: last(/STATUS:\s*(done|blocked)/gi)?.toLowerCase() ?? null,
    itemState: last(/ITEM_STATE:\s*(complete|partial)/gi)?.toLowerCase() ?? null,
    remaining: last(/REMAINING:\s*(.+)/gi)?.trim() ?? null,
    verdict: last(/VERDICT:\s*(PASS|FAIL)/gi)?.toUpperCase() ?? null,
    changed: last(/CHANGED:\s*(.+)/gi)?.trim() ?? null,
    tests: last(/TESTS:\s*(.+)/gi)?.trim() ?? null,
    reasons: last(/REASONS:\s*([\s\S]+)/gi)?.trim() ?? null,
    blocked: last(/BLOCKED:\s*(.+)/gi)?.trim() ?? null,
    tail,
  };
}

// ---------------------------------------------------------------------------
// worktrees
// ---------------------------------------------------------------------------

/**
 * Create (or reuse) the item's worktree.
 *
 * On reuse, the worktree may have been created against an older base commit.
 * The gate diffs are taken against `base`, so a stale worktree would report
 * every change the base branch made since then as if the worker had made it -
 * false scope violations. So: preserve whatever the previous run left behind,
 * then rebase the branch onto the current base. A conflict means the item is
 * genuinely blocked, and it is reported as such.
 */
async function makeWorktree(root, branch, base, stateDir, log) {
  const existing = await git(["worktree", "list", "--porcelain"], REPO_ROOT);
  const known = existing.stdout.includes(`worktree ${root.replace(/\\/g, "/")}`);

  if (!known) {
    fs.mkdirSync(path.dirname(root), { recursive: true });
    await git(["worktree", "add", "-b", branch, root, base], REPO_ROOT, 300_000);
    return { reused: false };
  }

  // Undo the harness's own environment patches from a previous run, so they
  // are never carried into the item's commit.
  if (stateDir) await restoreHarnessPatches(stateDir, root, log);

  // Preserve the previous run's work as a commit so the rebase can carry it.
  await git(["add", "-A"], root);
  const staged = await git(["diff", "--cached", "--quiet"], root);
  if (staged.code !== 0) {
    await git(
      ["commit", "-m", `wip(${branch}): work preserved from a previous run`],
      root,
      120_000,
    );
  } else {
    await git(["reset", "--quiet"], root);
  }

  const rebase = await git(["rebase", base], root, 300_000);
  if (rebase.code !== 0) {
    await git(["rebase", "--abort"], root);
    return { reused: true, stale: true, conflict: rebase.stdout + rebase.stderr };
  }
  return { reused: true };
}

async function removeWorktree(root, branch, log) {
  // A worktree holds a full node_modules - tens of thousands of files - so
  // the removal takes minutes on Windows. git gives up when it times out and
  // leaves the directory behind (deregistered, but still on disk).
  const r = await git(["worktree", "remove", "--force", root], REPO_ROOT, 600_000);
  if (r.code !== 0 || fs.existsSync(root)) {
    await git(["worktree", "prune"], REPO_ROOT, 120_000);
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch {
      /* reported below */
    }
  }
  await git(["branch", "-D", branch], REPO_ROOT, 60_000);
  if (fs.existsSync(root)) {
    log?.(`  warning: could not fully remove the worktree ${root}`);
    return false;
  }
  return true;
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

  const scopeRoots = ctx.scopeRoots ?? [packageRoot];
  // The scope is what the gate enforces: the packages an item may touch.
  // The files the item names are only guidance - where the work belongs.
  const allowed = scopeRoots.join(", ");
  const focus = itemPaths(item, packageRoot, REPO_ROOT);
  const gateText = gates.join("\n");

  log(`  worktree: ${worktree}`);
  log(`  scope:    ${allowed}`);
  if (focus.length) log(`  focus:    ${focus.join(", ")}`);

  const wt = await makeWorktree(worktree, branch, base, ctx.stateDir, log);
  if (wt.reused) log("  reusing the existing worktree from a previous run");
  if (wt.conflict) {
    log(`  could not rebase the previous run's work onto the current base:\n${wt.conflict.slice(0, 400)}`);
    state.items[itemId] = { status: "blocked", reason: "stale worktree conflicts with the current base" };
    return { itemId, status: "blocked" };
  }

  // dependencies for the worktree (pnpm store makes this quick)
  let patchedFiles = [];
  if (!fs.existsSync(path.join(worktree, "node_modules"))) {
    log("  installing dependencies in the worktree...");
    const install = await installDeps(worktree, log, ctx.stateDir);
    if (!install.ok) {
      log(`  install failed:\n${install.output.split(/\r?\n/).slice(-8).join("\n")}`);
      state.items[itemId] = { status: "blocked", reason: "pnpm install failed in worktree" };
      return { itemId, status: "blocked" };
    }
    patchedFiles = install.patched;
  }

  const implementer = await spawnAgent(agentName("plan", itemId), worktree, ctx.parent);
  log(`  implementer: ${implementer.address}`);

  let lastFailures = [];
  let lastBlockReason = null;
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
      FOCUS_FILES: focus.join(", ") || "(none named - work it out from the item)",
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
      done: /STATUS:\s*(done|blocked)/i,
    });
    const report = parseReport(screen);

    if (report.status === null) {
      log(`  note: the worker did not end with a status trailer - judging the diff alone`);
    }

    if (report.status === "blocked") {
      const reason = report.blocked ?? "(no reason given)";
      // The same blocker twice means the worker needs a human decision, not
      // another attempt. Stop and report it instead of burning the attempts.
      if (lastBlockReason && lastBlockReason === reason) {
        log(`  worker is blocked for the same reason again: ${reason}`);
        log(`  -> this item needs a human decision; not retrying`);
        lastFailures = [{ gate: "worker", detail: `worker reported blocked: ${reason}` }];
        break;
      }
      lastBlockReason = reason;
      lastFailures = [{ gate: "worker", detail: `worker reported blocked: ${reason}` }];
      log(`  worker reported blocked: ${reason}`);
      continue;
    }

    log("  running mechanical gates...");
    const gateResult = await runGates({
      worktree, base, item, packageRoot, scopeRels: ctx.scopeRels, checklistRel, gates,
      baseline: ctx.baseline, onLog: log, stateDir: ctx.stateDir,
    });
    lastFailures = gateResult.failures;
    if (lastFailures.length) {
      log(`  gates failed: ${lastFailures.map((f) => f.gate).join(", ")}`);
      continue;
    }
    log("  gates passed");

    // Files the harness itself patched (pnpm's build policy) must not be part
    // of the item's commit - they are environment fixes, not the worker's work.
    if (ctx.stateDir) await restoreHarnessPatches(ctx.stateDir, worktree, log);

    // squash the worker's work into one commit on the item branch
    await git(["add", "-A"], worktree);
    await git(["reset", "--soft", base], worktree);
    await git(
      ["commit", "-m", `plan(${itemId}): ${item.text.slice(0, 72)}`],
      worktree,
      120_000,
    );
    const head = (await git(["rev-parse", "HEAD"], worktree)).stdout.trim();

    // The evidence line reports how many files the item changed, so count the
    // files in the COMMIT - not the snapshot taken before the gates ran. The
    // two differ: the install can add a lockfile entry mid-gate, so the
    // snapshot was one file short of the truth.
    const committedFiles = (await git(["diff", "--name-only", `${base}..${head}`], worktree))
      .stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

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
      DIFF_FILE: path.join(briefDir, "review.diff"),
    };
    // The reviewer may not be able to run shell commands in this environment, so
    // the orchestrator writes the diff out for it to read.
    const diffText = (await git(["diff", `${base}..${head}`], worktree)).stdout;
    fs.writeFileSync(reviewVars.DIFF_FILE, diffText, "utf8");
    const reviewBrief = renderBrief(
      fs.readFileSync(path.join(BRIEFS, "review.md"), "utf8"),
      reviewVars,
    );
    const reviewFile = path.join(briefDir, "review.md");
    fs.writeFileSync(reviewFile, reviewBrief, "utf8");
    const reviewScreen = await sendAndWait(
      reviewer.address,
      `Read the review brief at "${reviewFile}" and execute it exactly. The diff to review is at "${reviewVars.DIFF_FILE}". Review the diff for item ${itemId}.`,
      { timeout: args.turnTimeout, done: /VERDICT:\s*(PASS|FAIL)/i },
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
      // Recorded so a later run can merge this item without repeating the
      // work: every gate passed and the independent reviewer said PASS.
      mergeable: true,
      worktree,
      branch,
      head,
      changed: committedFiles.length ? committedFiles : gateResult.changed,
      commandResults: gateResult.commandResults,
      proof: gateResult.proofDetail ?? null,
      itemState: report.itemState ?? "complete",
      remaining: report.remaining ?? null,
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
      needsHuman: lastBlockReason ? lastBlockReason : undefined,
      worktree,
      branch,
    };
    if (!args.keepBlocked) await removeWorktree(worktree, branch, log);
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
  const { baseRef, log, checklistAbs, checklistRel, item, planId } = ctx;

  // The merge must land on the base branch, and that branch moves while the
  // run is in progress: every merged item adds a commit, and so does anything
  // else that touches the repo. So the tip is resolved FRESH here.
  //
  // Resolving the startup SHA again would be a no-op rebase - the item would
  // stay on the old base and the fast-forward merge would fail with
  // "Not possible to fast-forward".
  const onBranch = (await git(["rev-parse", "--abbrev-ref", "HEAD"], REPO_ROOT)).stdout.trim();
  const baseIsSha = /^[0-9a-f]{7,40}$/i.test(baseRef);
  if (!baseIsSha && onBranch !== baseRef) {
    log(`  refusing to merge: HEAD is on "${onBranch}", not the base branch "${baseRef}"`);
    return { ok: false, reason: `not on the base branch (${onBranch} != ${baseRef})` };
  }

  let merged = false;
  for (let attempt = 1; attempt <= 2 && !merged; attempt++) {
    const baseSha = (await git(["rev-parse", baseRef], REPO_ROOT)).stdout.trim();
    log(`  merging onto ${baseRef} @ ${baseSha.slice(0, 7)}`);

    // rebase onto the current base (other items may have merged first)
    const rebase = await git(["rebase", baseSha], result.worktree, 300_000);
    if (rebase.code !== 0) {
      await git(["rebase", "--abort"], result.worktree);
      log(`  rebase conflict -> item blocked`);
      return { ok: false, reason: "rebase conflict" };
    }

    // re-run the commands after the rebase
    const install = await installDeps(result.worktree, log, ctx.stateDir);
    if (!install.ok) {
      log("  post-rebase install failed");
      return { ok: false, reason: "post-rebase install failed" };
    }
    for (const cmd of ctx.gates) {
      const r = await execCmd(cmd, { cwd: result.worktree, timeout: 1_200_000 });
      if (r.code !== 0) {
        log(`  post-rebase gate failed: ${cmd}`);
        return { ok: false, reason: `post-rebase gate failed: ${cmd}` };
      }
    }

    const merge = await git(["merge", "--ff-only", result.branch], REPO_ROOT, 120_000);
    if (merge.code === 0) {
      merged = true;
      break;
    }

    // The base moved between the rebase and the merge (another item merged, or
    // something else committed). Resolve the new tip and try once more.
    const tip = (await git(["rev-parse", baseRef], REPO_ROOT)).stdout.trim();
    if (attempt === 1 && tip !== baseSha) {
      log(`  the base moved during the merge (${baseSha.slice(0, 7)} -> ${tip.slice(0, 7)}) - retrying`);
      continue;
    }
    log(`  merge failed: ${merge.stdout}${merge.stderr}`);
    return { ok: false, reason: "merge failed" };
  }
  if (!merged) return { ok: false, reason: "merge failed" };

  // the orchestrator owns the checklist and the evidence log
  const lines = fs.readFileSync(checklistAbs, "utf8").split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes(item.head.slice(0, 60)));
  const partial = result.itemState === "partial";
  if (idx >= 0) {
    if (partial) {
      // A partial item stays partial: keep [~] and state what still stands in the way.
      const gap = result.remaining ? ` — remaining: ${result.remaining}` : "";
      lines[idx] = lines[idx].replace(/^- \[.\]/, "- [~]").replace(/\s*$/, "") + gap;
    } else {
      lines[idx] = lines[idx].replace(/^- \[( |~)\]/, "- [x]");
    }
  }
  const evidenceIdx = lines.findIndex((l) => /^#{1,6}\s+evidence log/i.test(l));
  const summary = result.commandResults
    .map((c) => `${c.cmd} => exit ${c.code}`)
    .join("; ");
  const diffStat = result.changed.length;
  const proofText = result.proof ? `; proof: ${result.proof}` : "";
  const entry =
    `- ${new Date().toISOString().slice(0, 10)} — ${item.id}: ${item.text.slice(0, 90)} ` +
    `(${summary}; ${diffStat} file(s) changed${proofText}; independent review: PASS` +
    `${partial ? `; still partial: ${result.remaining ?? "gap not stated"}` : ""}).`;
  if (evidenceIdx >= 0) {
    // One authoritative line per item: a re-run replaces that item's old line
    // instead of piling duplicates on top of it. The history lives in git.
    const existing = lines.findIndex(
      (l, i) => i > evidenceIdx && l.includes(`— ${item.id}:`),
    );
    if (existing >= 0) lines.splice(existing, 1);
    lines.splice(evidenceIdx + 1, 0, entry);
  }
  fs.writeFileSync(checklistAbs, lines.join("\n"), "utf8");
  await git(["add", checklistRel], REPO_ROOT);
  await git(
    ["commit", "-m", `docs(checklist): mark ${item.id} complete`],
    REPO_ROOT,
    120_000,
  );

  await removeWorktree(result.worktree, result.branch, log);
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
  // Scope: the packages an item may touch. Defaults to the checklist's own
  // package; --scope allows a checklist that spans several packages.
  const scopeRoots = (
    args.scope.length
      ? args.scope.map((s) => path.resolve(REPO_ROOT, s))
      : [args.pkg ? path.resolve(REPO_ROOT, args.pkg) : path.resolve(path.dirname(checklistAbs))]
  ).filter((p) => fs.existsSync(p));
  const packageRoot = scopeRoots[0];

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
  // Gates: one typecheck + lint + test per package in scope.
  const gates =
    args.gates ??
    scopeRoots.flatMap((root) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
      const out = [`pnpm --filter ${pkg.name} run typecheck`];
      if (pkg.scripts?.lint) out.push(`pnpm --filter ${pkg.name} run lint`);
      const testScript = pkg.scripts?.["test:all"] ?? pkg.scripts?.test;
      if (testScript) out.push(`pnpm --filter ${pkg.name} run ${pkg.scripts?.["test:all"] ? "test:all" : "test"}`);
      return out;
    });

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
    // `base` is the SHA the run started from (the diffs are taken against it);
    // `baseRef` is the branch it points at. The branch moves during a run, so
    // the merge phase resolves the tip of `baseRef` again before it merges.
    args, base: baseSha, baseRef: args.base,
    packageRoot, checklistRel, checklistAbs, gates, state,
    stateDir, ledgerFile, worktreeRoot, planId, baseline, log,
    parent: args.parent,
    scopeRoots,
    scopeRels: scopeRoots.map((p) => path.relative(REPO_ROOT, p).replace(/\\/g, "/")),
  };

  // implementation phase, N items at a time
  const queue = selected.slice(0, args.maxItems);
  const results = [];
  if (args.mergeOnly) {
    // Recovery path: merge the items that already passed every gate and the
    // independent review, without running a worker again. Used when the
    // merge itself failed (a diverged base, a conflict) and the work is good.
    log("\n=== merge-only mode: no workers are spawned ===");
    for (const item of queue) {
      const s = state.items[item.id];
      if (!s?.mergeable) {
        log(`\n=== ${item.id} ===\n  not mergeable - no recorded gate pass (skipped)`);
        continue;
      }
      log(`\n=== ${item.id} (${item.state}) ${item.section} ===`);
      results.push({ item, ...s });
    }
  } else {
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
  }

  // merge phase, one at a time, in checklist order (not completion order, so
  // the sequence is deterministic and dependent items land in the right order)
  log("\n=== merge phase ===");
  const order = new Map(queue.map((item, i) => [item.id, i]));
  results.sort((a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0));
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
