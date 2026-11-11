// runtime/context.ts
// Request-scoped execution context for the memory engine.
//
// The model never supplies an owner id or a permission level. The server
// establishes both once per request, and every memory tool reads them from
// here (AsyncLocalStorage) instead of a module-level default. That closes the
// "global local identity" hole: concurrent authenticated requests cannot
// borrow each other's owner.
//
// Deployment modes:
//   - single-user (local dev): the default. Owner falls back to the configured
//     PAME_OWNER_ID / PAME_LOCAL_OWNER, then "local". Deliberate, explicit.
//   - multi-user: enabled with PAME_MULTI_USER=true. There is NO fallback
//     owner — a request without an authenticated identity is denied.

import { AsyncLocalStorage } from "node:async_hooks";

export type AgentMode = "Chat" | "Plan" | "Auto";

export interface MemoryPermissions {
  /** May create/update/link/merge memories. */
  write: boolean;
  /** May permanently delete memories. Always additionally gated by an
   *  explicit human confirmation for the turn. */
  delete: boolean;
}

export interface MemoryRuntimeContext {
  /** Authenticated owner. Always present once accepted. */
  ownerId: string;
  mode: AgentMode;
  /** Set true only when the human explicitly confirmed destructive operations
   *  in this request. The model cannot set this. */
  destructiveConfirmed: boolean;
  permissions: MemoryPermissions;
}

export class MemoryAccessError extends Error {
  readonly code:
    | "no_identity"
    | "forbidden"
    | "confirmation_required";
  constructor(code: MemoryAccessError["code"], message: string) {
    super(message);
    this.name = "MemoryAccessError";
    this.code = code;
  }
}

/** A multi-user deployment must be declared explicitly. */
export function isMultiUserDeployment(): boolean {
  return process.env.PAME_MULTI_USER === "true";
}

/** The owner used only in deliberate single-user/local-dev mode. */
export function localOwnerId(): string {
  return (
    process.env.PAME_OWNER_ID ??
    process.env.PAME_LOCAL_OWNER ??
    "local"
  );
}

export function permissionsFor(
  mode: AgentMode,
  destructiveConfirmed: boolean,
): MemoryPermissions {
  const write = mode === "Auto";
  return { write, delete: write && destructiveConfirmed };
}

const storage = new AsyncLocalStorage<MemoryRuntimeContext>();

/**
 * Resolve the owner for a request. In multi-user mode a missing identity is a
 * hard denial — never a shared "local" bucket. In local-dev mode we fall back
 * to the configured local owner so scripts and the single-user UI keep working.
 */
export function resolveOwnerId(requested?: string | null): string {
  const ctx = storage.getStore();
  if (ctx?.ownerId) return ctx.ownerId;
  if (isMultiUserDeployment()) {
    throw new MemoryAccessError(
      "no_identity",
      "Memory access denied: no authenticated identity (multi-user deployment).",
    );
  }
  const fallback = requested?.trim() || localOwnerId();
  return fallback;
}

export function getMemoryContext(): MemoryRuntimeContext | null {
  return storage.getStore() ?? null;
}

export function requireMemoryContext(): MemoryRuntimeContext {
  const ctx = storage.getStore();
  if (ctx) return ctx;
  if (isMultiUserDeployment()) {
    throw new MemoryAccessError(
      "no_identity",
      "Memory access denied: no request context (multi-user deployment).",
    );
  }
  // Local-dev: synthesize a permissive-but-explicit context.
  return {
    ownerId: localOwnerId(),
    mode: "Auto",
    destructiveConfirmed: false,
    permissions: permissionsFor("Auto", false),
  };
}

export function requirePermission(kind: "write" | "delete"): void {
  const ctx = requireMemoryContext();
  if (!ctx.permissions[kind]) {
    throw new MemoryAccessError(
      "forbidden",
      `Memory ${kind} is not permitted in ${ctx.mode} mode.`,
    );
  }
  if (kind === "delete" && !ctx.destructiveConfirmed) {
    throw new MemoryAccessError(
      "confirmation_required",
      "Destructive memory operations require explicit human confirmation.",
    );
  }
}

/** Run `fn` inside a freshly established request context. */
export function runWithMemoryContext<T>(
  input: {
    ownerId: string | null | undefined;
    mode: AgentMode;
    destructiveConfirmed?: boolean;
  },
  fn: () => T,
): T {
  let ownerId: string;
  if (input.ownerId && input.ownerId.trim()) {
    ownerId = input.ownerId.trim();
  } else if (isMultiUserDeployment()) {
    throw new MemoryAccessError(
      "no_identity",
      "Memory access denied: no authenticated identity (multi-user deployment).",
    );
  } else {
    ownerId = localOwnerId();
  }
  const ctx: MemoryRuntimeContext = {
    ownerId,
    mode: input.mode,
    destructiveConfirmed: input.destructiveConfirmed === true,
    permissions: permissionsFor(input.mode, input.destructiveConfirmed === true),
  };
  return storage.run(ctx, fn);
}
