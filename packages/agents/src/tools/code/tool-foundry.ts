import { tool, type Tool } from "ai";
import { z } from "zod";

import {
  ROOT,
  resolveSafe,
  toRel,
  assertWritable,
  atomicWrite,
  readTextFile,
  clip,
} from "../shared/workspace.js";
import { assertCanWrite, assertCanRunShell } from "../shared/permissions.js";
import { runProcess } from "../shared/process.js";

import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ALLOW_NAME = /^[a-zA-Z0-9_-]{2,40}$/;
const FOUNDRY_DIR = "tools/foundry";
const HEADER_PREFIX = "// nimo-tool:";

const SCAFFOLD = `export default async function run(args = {}, ctx) {
  // ctx.workspaceRoot -> absolute workspace path
  // ctx.resolve(rel)   -> absolute path inside the workspace (async, throws if it escapes)
  // ctx.readText(rel)  -> file contents (async)
  // ctx.run(argv, { cwd, timeoutMs, waitMs }) -> { ok, exitCode, stdout, stderr }
  // ctx.writeText(rel, content) -> write a file (async, requires write permission)
  // ctx.log(message)   -> annotate the tool result
  return { ok: true };
}`;

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

interface FoundrySource {
  name: string;
  path: string;
  description?: string;
  params?: string;
  format: "esm" | "legacy-ts";
  supported: boolean;
  bytes?: number;
  mtime?: string;
}

function parseHeader(code: string): { description?: string; params?: string } {
  const head = code.split(/\r?\n/).slice(0, 12);
  let description: string | undefined;
  let params: string | undefined;
  for (const line of head) {
    const desc = line.match(/\/\/\s*description:\s*(.+)$/i);
    if (desc) description = desc[1]!.trim();
    const param = line.match(/\/\/\s*params:\s*(.+)$/i);
    if (param) params = param[1]!.trim();
  }
  return { description, params };
}

function buildFile({
  description,
  params,
  code,
}: {
  description: string;
  params?: string;
  code: string;
}): string {
  const oneLine = description.replace(/\r?\n/g, " ").trim();
  const lines = [
    `${HEADER_PREFIX} workspace tool — created by createTool`,
    `// description: ${oneLine}`,
  ];
  if (params) lines.push(`// params: ${params.replace(/\r?\n/g, " ").trim()}`);
  lines.push("// Contract: export default async function run(args, ctx) { ... }");
  return `${lines.join("\n")}\n${code.trim()}\n`;
}

async function listFoundry(): Promise<FoundrySource[]> {
  const dir = await resolveSafe(FOUNDRY_DIR);
  const entries = await fsp.readdir(dir).catch(() => [] as string[]);
  const out: FoundrySource[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const isEsm = entry.endsWith(".mjs");
    const isLegacy = entry.endsWith(".ts");
    if (!isEsm && !isLegacy) continue;

    const full = path.join(dir, entry);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat?.isFile()) continue;

    const source = await fsp.readFile(full, "utf-8").catch(() => "");
    const { description, params } = parseHeader(source);

    out.push({
      name: entry.replace(/\.(mjs|ts)$/, ""),
      path: toRel(full),
      description:
        description ??
        source.match(/\/\/\s*AUTO-GENERATED[^-]*-\s*(.+)/)?.[1]?.slice(0, 200),
      params,
      format: isEsm ? "esm" : "legacy-ts",
      supported: isEsm,
      bytes: stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export const createToolTool: Tool = tool({
  description:
    "Create or update a reusable workspace tool at tools/foundry/<name>.mjs, then call it with callWorkspaceTool. " +
    "The file MUST be a self-contained ES module (JavaScript, not TypeScript) with this exact contract:\n" +
    "  export default async function run(args = {}, ctx) { ... return result; }\n" +
    "ctx provides: workspaceRoot (absolute path), cwd, resolve(rel) (async -> absolute path, sandboxed), " +
    "readText(rel), readJson(rel), writeText(rel, content) (async, needs write permission), " +
    "run(argv, { cwd, timeoutMs, waitMs }) (async -> { ok, exitCode, stdout, stderr }), exists(rel), log(message).\n" +
    "Rules: plain JavaScript only (no TypeScript types, no JSX); node: builtins are allowed; " +
    "do NOT import child_process (use ctx.run with an allowlisted argv) and do NOT call process.exit/process.kill. " +
    "The file is syntax-checked with `node --check` before it is saved; on failure return the compiler output so you can fix it. " +
    "If the name already exists it is NOT overwritten unless overwrite=true (the existing source is returned so you can fix it). " +
    "Requires write permission (Auto mode).",

  inputSchema: z.object({
    name: z.string().regex(ALLOW_NAME, "name must be 2-40 chars: letters, numbers, underscore, hyphen")
      .describe("Tool name, e.g. 'count-todos'"),
    description: z.string().min(10).max(500).describe("What the tool does - shown to the model"),
    params: z.string().max(2_000).optional()
      .describe("Plain-text argument docs, e.g. 'path: string (required) - file to scan'"),
    code: z.string().min(40).max(50_000)
      .describe(
        `The module body starting at "export default async function run(args, ctx)". Example:\n${SCAFFOLD}`,
      ),
    overwrite: z.boolean().default(false)
      .describe("Replace an existing tool file (use this to fix a broken tool)"),
  }),

  execute: async ({ name, description, params, code, overwrite }) => {
    try {
      assertCanWrite("createTool");

      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
      const dir = await resolveSafe(FOUNDRY_DIR);
      await fsp.mkdir(dir, { recursive: true });

      const file = path.join(dir, `${safeName}.mjs`);
      assertWritable(file);

      if ((await exists(file)) && !overwrite) {
        const existing = clip(await fsp.readFile(file, "utf-8").catch(() => ""), 8_000);
        return {
          success: false as const,
          created: false,
          name: safeName,
          path: toRel(file),
          error: `Tool '${safeName}' already exists and overwrite=false.`,
          existingSource: existing,
          hint:
            "To fix it, call createTool again with overwrite=true and the complete corrected file " +
            "(or edit the file with writeFile overwrite=true). Do not duplicate the name.",
        };
      }

      if (!/export\s+default/.test(code)) {
        throw new Error(
          "Code must export the runner: `export default async function run(args = {}, ctx) { ... }`",
        );
      }
      if (/(?:from\s*["'](?:node:)?child_process["']|require\(\s*["'](?:node:)?child_process["']\s*\))/.test(code)) {
        throw new Error(
          "Do not import child_process. Use `await ctx.run([\"git\", \"status\"])` instead - it shares the allowlist and sandbox.",
        );
      }
      if (/process\.(?:exit|kill)\s*\(/.test(code)) {
        throw new Error("Do not call process.exit/process.kill inside a workspace tool.");
      }

      const content = buildFile({ description, params, code });

      // Syntax check BEFORE the real file exists, so a broken tool never
      // shadows a working one and the model can always retry with the fix.
      const probe = path.join(dir, `.check-${safeName}-${Date.now()}.mjs`);
      await fsp.writeFile(probe, content, "utf-8");
      let syntax: { ok: boolean; log?: string } = { ok: true };
      try {
        const check = await runProcess({
          argv: ["node", "--check", toRel(probe)],
          cwd: ROOT,
          timeoutMs: 30_000,
          maxOutputBytes: 20_000,
        });
        if (!check.ok) {
          syntax = {
            ok: false,
            log: clip([check.stdout, check.stderr].filter(Boolean).join("\n"), 4_000),
          };
        }
      } finally {
        await fsp.unlink(probe).catch(() => {});
      }

      if (!syntax.ok) {
        return {
          success: false as const,
          created: false,
          name: safeName,
          error: "Syntax check failed - the tool was not saved.",
          syntax,
          hint:
            "Fix the syntax error above and call createTool again with the corrected complete module. " +
            "Plain JavaScript only: no type annotations, no interfaces, no `import type`.",
        };
      }

      await atomicWrite(file, content);

      return {
        success: true as const,
        created: true,
        overwritten: overwrite,
        name: safeName,
        path: toRel(file),
        syntax,
        hint:
          "Saved. Call it now with callWorkspaceTool({ name: \"" +
          safeName +
          "\", args: { ... } }) and verify the output before telling the user it works.",
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const listWorkspaceToolsTool: Tool = tool({
  description:
    "List workspace tools created with createTool under tools/foundry/, with description, argument docs and format. " +
    "Use this before writing a new tool. Files marked legacy-ts are old and must be recreated as .mjs.",

  inputSchema: z.object({
    filter: z.string().max(100).optional().describe("Case-insensitive name/description filter"),
  }),

  execute: async ({ filter }) => {
    try {
      const all = await listFoundry();
      const needle = filter?.toLowerCase();
      const matches = needle
        ? all.filter(
            (t) =>
              t.name.toLowerCase().includes(needle) ||
              (t.description ?? "").toLowerCase().includes(needle),
          )
        : all;

      return {
        success: true as const,
        count: matches.length,
        tools: matches,
        hint:
          matches.length === 0
            ? "No foundry tools yet. Use createTool to add one."
            : matches.some((t) => !t.supported)
              ? "legacy-ts tools are not callable. Recreate them with createTool (JavaScript .mjs)."
              : undefined,
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

interface WorkspaceRunOptions {
  cwd?: string;
  timeoutMs?: number;
  waitMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
}

function buildToolContext(logs: string[]) {
  return {
    workspaceRoot: ROOT,
    cwd: ROOT,
    log: (message: unknown) => {
      if (logs.length < 200) logs.push(String(message).slice(0, 2_000));
    },
    resolve: (rel: string) => resolveSafe(rel),
    exists: async (rel: string) => exists(await resolveSafe(rel)),
    readText: async (rel: string, maxBytes?: number) =>
      (await readTextFile(await resolveSafe(rel), maxBytes ?? 200_000)).text,
    readJson: async (rel: string) =>
      JSON.parse((await readTextFile(await resolveSafe(rel), 2_000_000)).text),
    writeText: async (rel: string, content: string) => {
      assertCanWrite("workspace tool write");
      const full = await resolveSafe(rel);
      assertWritable(full);
      await atomicWrite(full, String(content));
      return toRel(full);
    },
    run: async (commandOrArgv: string | string[], opts: WorkspaceRunOptions = {}) => {
      assertCanRunShell();
      const isArgv = Array.isArray(commandOrArgv);
      const cwd = opts.cwd ? await resolveSafe(opts.cwd) : ROOT;
      const result = await runProcess({
        argv: isArgv ? commandOrArgv : undefined,
        command: isArgv ? undefined : String(commandOrArgv),
        cwd,
        timeoutMs: opts.timeoutMs ?? 120_000,
        waitMs: opts.waitMs ?? 60_000,
        maxOutputBytes: opts.maxOutputBytes ?? 60_000,
        env: opts.env,
      });
      return {
        ok: result.ok,
        running: result.running === true,
        id: result.id,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: clip(result.stdout, 20_000),
        stderr: clip(result.stderr, 20_000),
      };
    },
  };
}

export const callWorkspaceToolTool: Tool = tool({
  description:
    "Call a workspace tool created with createTool (tools/foundry/<name>.mjs) with JSON arguments. " +
    "The tool runs in the same sandbox and permissions as the built-in tools. " +
    "If it throws, the error is returned so you can fix the file with createTool overwrite=true and call it again. " +
    "Always verify a new tool with a real call before reporting success.",

  inputSchema: z.object({
    name: z.string().regex(ALLOW_NAME).describe("Tool name from listWorkspaceTools"),
    args: z.record(z.string(), z.unknown()).default({})
      .describe("Arguments object passed to the tool's run(args, ctx) function"),
  }),

  execute: async ({ name, args }) => {
    try {
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-");
      const dir = await resolveSafe(FOUNDRY_DIR);
      const file = path.join(dir, `${safeName}.mjs`);

      if (!(await exists(file))) {
        const legacy = path.join(dir, `${safeName}.ts`);
        if (await exists(legacy)) {
          return {
            success: false as const,
            name: safeName,
            error: `'${safeName}' only exists as legacy TypeScript (${toRel(legacy)}), which cannot be imported at runtime.`,
            hint:
              "Recreate it with createTool as a JavaScript .mjs module " +
              "(export default async function run(args, ctx) {...}), then call it again.",
          };
        }
        throw new Error(
          `Tool '${safeName}' not found. Use listWorkspaceTools to see available tools.`,
        );
      }

      // Cache-bust so an edited tool is picked up immediately.
      const stat = await fsp.stat(file);
      const mod = (await import(
        `${pathToFileURL(file).href}?v=${stat.mtimeMs}`
      )) as { default?: unknown };

      if (typeof mod.default !== "function") {
        throw new Error(
          `Tool '${safeName}' is malformed: it must export default async function run(args, ctx).`,
        );
      }

      const logs: string[] = [];
      const ctx = buildToolContext(logs);
      const runner = mod.default as (
        input: Record<string, unknown>,
        context: typeof ctx,
      ) => Promise<unknown>;

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Workspace tool timed out after 180s")),
          180_000,
        );
      });

      let output: unknown;
      try {
        output = await Promise.race([runner(args ?? {}, ctx), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }

      return {
        success: true as const,
        tool: safeName,
        output: output === undefined ? null : output,
        logs: logs.length > 0 ? logs : undefined,
        hint:
          "Check that the output answers the request. If it is wrong, fix the tool with createTool overwrite=true.",
      };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
