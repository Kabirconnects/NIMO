// tools/shared/permissions.ts
// Filesystem / shell permissions for tool execution.
//
// The mode is established by runAgent() through the memory runtime context
// (AsyncLocalStorage). Reading it here means a tool cannot be tricked into
// writing by the model, and concurrent requests cannot borrow each other's
// permissions. AGENT_ALLOW_WRITE / AGENT_ALLOW_SHELL remain explicit
// overrides for CLI or test runs where no agent context exists.

import { requireMemoryContext } from "@workspace/memory";
import type { AgentMode } from "../../core/tools/tools-mode-types.js";

export function activeMode(): AgentMode | null {
  try {
    return requireMemoryContext().mode as AgentMode;
  } catch {
    return null;
  }
}

export function canWriteFiles(): boolean {
  if (process.env.AGENT_ALLOW_WRITE === "true") return true;
  return activeMode() === "Auto";
}

export function canRunShell(): boolean {
  if (process.env.AGENT_ALLOW_SHELL === "true") return true;
  return activeMode() === "Auto";
}

export function assertCanWrite(action = "write"): void {
  if (!canWriteFiles()) {
    throw new Error(
      `Filesystem ${action} is not permitted in ${activeMode() ?? "this"} mode. Use Auto mode or set AGENT_ALLOW_WRITE=true.`,
    );
  }
}

export function assertCanRunShell(): void {
  if (!canRunShell()) {
    throw new Error(
      `Shell commands are not permitted in ${activeMode() ?? "this"} mode. Use Auto mode or set AGENT_ALLOW_SHELL=true.`,
    );
  }
}
