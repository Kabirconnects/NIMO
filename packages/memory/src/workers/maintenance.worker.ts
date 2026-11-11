// workers/maintenance.worker.ts
// Background maintenance job handlers. Each kind is a real, idempotent
// operation — no worker claims a job just to mark it successful.
//
// Supported kinds:
//   reconcile   recompute graph_degree from the edge table
//   expire      archived ephemeral memories + redact expired experiences
//   cleanup     same retention pass (explicit alias)
//   index-check rebuild the FTS index and repair degrees
//
// Unknown job kinds fail loudly (and retry/dead-letter) instead of silently
// succeeding.

import { claimJob, finishJob, repairGraphDegrees, rebuildFtsIndex, applyRetention } from "../storage/db.js";

export type MaintenanceKind = "reconcile" | "expire" | "index-check" | "cleanup";

export function runMaintenanceJob(kind: MaintenanceKind): boolean {
  const job = claimJob(kind);
  if (!job) return false;

  try {
    switch (kind) {
      case "reconcile":
        repairGraphDegrees(job.ownerId);
        break;
      case "expire":
      case "cleanup":
        applyRetention(job.ownerId, {
          ephemeralTtlDays: numberOr(job.payload.ephemeralTtlDays, 30),
          experienceTtlDays: numberOr(job.payload.experienceTtlDays, 365),
          revisionTtlDays: numberOr(job.payload.revisionTtlDays, 365),
        });
        break;
      case "index-check":
        rebuildFtsIndex();
        repairGraphDegrees(job.ownerId);
        break;
      default: {
        const never: never = kind;
        throw new Error(`unsupported maintenance kind: ${String(never)}`);
      }
    }
    finishJob(job.id, true);
  } catch (err) {
    finishJob(job.id, false, (err as Error).message);
  }
  return true;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
