import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const DEFAULT_WORKSPACE = String.raw`C:\Users\Himanshu Arodia\.nimo`;

export const ROOT = fs.realpathSync(
  // path.resolve(process.env.AGENT_WORKSPACE ?? process.cwd()),
  path.resolve(process.env.AGENT_WORKSPACE ?? DEFAULT_WORKSPACE),
);
export const ALLOW_WRITE = process.env.AGENT_ALLOW_WRITE === "true";
export const ALLOW_SHELL = process.env.AGENT_ALLOW_SHELL === "true";

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
]);

const SECRET =
  /(^|[\\/])(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519))$/i;
export const isSecret = (full: string) => SECRET.test(full);

function inside(p: string) {
  const r = path.relative(ROOT, p);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
}

export async function resolveSafe(input: string): Promise<string> {
  const full = path.resolve(ROOT, input);
  if (!inside(full)) throw new Error("Path is outside the workspace");

  // follow symlinks on the closest existing ancestor
  let probe = full;
  for (;;) {
    try {
      const real = await fsp.realpath(probe);
      if (!inside(real)) throw new Error("Path is outside the workspace");
      break;
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return full;
}

export const toRel = (full: string) =>
  path.relative(ROOT, full).split(path.sep).join("/") || ".";

export function assertWritable(full: string) {
  if (isSecret(full)) throw new Error("Secret files are blocked");
  const r = toRel(full);
  if (r === ".git" || r.startsWith(".git/"))
    throw new Error(".git is protected");
  if (r === "memories" || r.startsWith("memories/") || r.startsWith("sessions.db"))
    throw new Error("Managed by the memory system. Use the memory tool.");
}

export function fail(e: unknown) {
  return { error: e instanceof Error ? e.message : String(e) };
}

export async function* walkFiles(
  dir: string,
  depth = 0,
): AsyncGenerator<string> {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < 8) yield* walkFiles(full, depth + 1);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

// Child processes must not inherit your API keys
export function safeEnv(): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "Path",
    "PATHEXT",
    "ComSpec",
    "SystemRoot",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "PNPM_HOME",
    "NODE_ENV",
    "CI",
  ];
  return Object.fromEntries(
    keep
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
}

export const clip = (s: string, max = 12_000) =>
  s.length > max ? s.slice(0, max) + "\n…(truncated)" : s;
export const tail = (s: string, max = 8_000) =>
  s.length > max ? "…(truncated)\n" + s.slice(-max) : s;
