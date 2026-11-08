// workers/ingestion.worker.ts
// Stage 6: consume durable "ingest" jobs (extract -> validate -> consolidate
// -> link -> embed). Job rows live in memory_jobs; claiming here is a
// two-step claim+finish over SQLite. extract/consolidate are Stage 2.

import { claimJob, finishJob } from "../storage/db.js";

export function runIngestionWorkerOnce(): boolean {
  const job = claimJob("ingest");
  if (!job) return false;
  try {
    // TODO(Stage 2/6): experienceId -> extract -> validate -> consolidate ->
    // link -> embed.
    finishJob(job.id, true);
  } catch (err) {
    finishJob(job.id, false, (err as Error).message);
  }
  return true;
}
