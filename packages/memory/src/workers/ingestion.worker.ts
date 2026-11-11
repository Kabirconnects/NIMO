// workers/ingestion.worker.ts
// Consume durable "ingest" jobs: an experience has already been captured;
// this worker runs extract -> validate -> consolidate against it.
//
// Jobs are claimed atomically (claimJob) and finished explicitly. A failure
// is retried with backoff and eventually marked "dead" — an empty worker can
// no longer mark a job successful.

import { claimJob, finishJob, findExperience, withTransaction } from "../storage/db.js";
import { extractCandidates, roleForExperience } from "../ingestion/extract.js";
import { validateCandidates } from "../ingestion/validate.js";
import { consolidate } from "../ingestion/consolidate.js";
import { DEFAULT_POLICY } from "../governance/policy.js";

export function runIngestionWorkerOnce(): boolean {
  const job = claimJob("ingest");
  if (!job) return false;

  try {
    const experienceId =
      typeof job.payload.experienceId === "string" ? job.payload.experienceId : undefined;
    if (!experienceId) {
      throw new Error("ingest job payload is missing experienceId");
    }

    const experience = findExperience(experienceId, job.ownerId);
    if (!experience) {
      throw new Error(`experience ${experienceId} not found for owner ${job.ownerId}`);
    }

    const candidates = extractCandidates(experience.content, {
      role: roleForExperience(experience.type),
    });
    const { accepted } = validateCandidates(candidates, DEFAULT_POLICY);
    if (accepted.length > 0) {
      withTransaction(() => consolidate(job.ownerId, accepted, experience.id));
    }

    finishJob(job.id, true);
  } catch (err) {
    finishJob(job.id, false, (err as Error).message);
  }
  return true;
}
