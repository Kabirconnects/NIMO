// ingestion/ingest.ts
// The full learning pipeline for one experience:
//
//   Capture   -> preserve the experience verbatim (provenance layer)
//   Extract   -> extract memory candidates (rule-based, no LLM)
//   Validate  -> policy gate: secrets, inferred, capture-enabled
//   Consolidate -> create / merge / link neurons and synapses
//
// Greetings are captured as experience (so context exists) but skipped for
// neuron creation — they are conversation glue, not durable beliefs.

import type {
  IngestionResult,
  IngestExperienceInput,
} from "../domain/service.types.js";
import { capture } from "./capture.js";
import { extractCandidates } from "./extract.js";
import { validateCandidates } from "./validate.js";
import { consolidate } from "./consolidate.js";
import { DEFAULT_POLICY, detectSecret, redactSecrets } from "../governance/policy.js";
import { withTransaction } from "../storage/db.js";

export function ingest(input: IngestExperienceInput): IngestionResult {
  // 0. Secret gate runs BEFORE capture. A turn containing credentials is
  //    recorded only in redacted form — the raw secret must never reach the
  //    experiences table (it would otherwise survive every later cleanup).
  const secret = detectSecret(input.content);
  const safeContent = secret ? redactSecrets(input.content) : input.content;

  // 1. Capture always happens — every turn is preserved as an experience.
  const experience = capture({
    ownerId: input.ownerId,
    content: safeContent,
    type: input.type,
    messageId: input.messageId,
    occurredAt: input.occurredAt,
    metadata: secret ? { redacted: true, reason: "secret" } : undefined,
  });

  if (secret) {
    return {
      experienceId: experience.id,
      created: 0, updated: 0, merged: 0, linked: 0, rejected: 1,
      memoryIds: [],
    };
  }

  if (!DEFAULT_POLICY.allowAutomaticCapture) {
    return {
      experienceId: experience.id,
      created: 0, updated: 0, merged: 0, linked: 0, rejected: 0,
      memoryIds: [],
    };
  }

  // 2. Extract candidates. Role matters: assistant/system text yields no
  //    factual memories (it is captured as an experience above).
  const candidates = extractCandidates(input.content, { role: input.role });
  if (candidates.length === 0) {
    return {
      experienceId: experience.id,
      created: 0, updated: 0, merged: 0, linked: 0, rejected: 0,
      memoryIds: [],
    };
  }

  // 3. Validate against governance policy.
  const { accepted, rejected } = validateCandidates(candidates, DEFAULT_POLICY);
  if (accepted.length === 0) {
    return {
      experienceId: experience.id,
      created: 0, updated: 0, merged: 0, linked: 0,
      rejected: rejected.length, memoryIds: [],
    };
  }

  // 4. Consolidate atomically: create / merge / link / revision writes either
  //    all land or none do.
  const out = withTransaction(() => consolidate(input.ownerId, accepted, experience.id));

  return {
    experienceId: experience.id,
    created: out.created,
    updated: out.updated,
    merged: out.merged,
    linked: out.linked,
    rejected: rejected.length,
    memoryIds: out.memoryIds,
  };
}
