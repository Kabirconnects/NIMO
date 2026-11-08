// workers/maintenance.worker.ts
// Stage 5/6 background maintenance: reconcile contradictions, expire
// temporary memories, index health, complete deletion cleanups.
// One function per job kind so each can be scheduled at its own cadence.

import { claimJob, finishJob } from "../storage/db.js";

export type MaintenanceKind =
  | "reconcile"
  | "expire"
  | "index-check"
  | "cleanup"
  | "evolve"
  | "link"
  | "embed";

/**
 * Process one pending maintenance job of the given kind.
 * TODO(Stage 5): implement each kind; all are idempotent + retryable.
 */
export function runMaintenanceJob(kind: MaintenanceKind): boolean {
  const job = claimJob(kind);
  if (!job) return false;
  try {
    finishJob(job.id, true);
  } catch (err) {
    finishJob(job.id, false, (err as Error).message);
  }
  return true;
}
