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
import { DEFAULT_POLICY } from "../governance/policy.js";

export function ingest(input: IngestExperienceInput): IngestionResult {
  // 1. Capture always happens — every turn is preserved as an experience.
  const experience = capture({
    ownerId: input.ownerId,
    content: input.content,
    type: input.type,
    messageId: input.messageId,
    occurredAt: input.occurredAt,
  });

  if (!DEFAULT_POLICY.allowAutomaticCapture) {
    return {
      experienceId: experience.id,
      created: 0, updated: 0, merged: 0, linked: 0, rejected: 0,
      memoryIds: [],
    };
  }

  // 2. Extract candidates (greetings yield zero candidates).
  const candidates = extractCandidates(input.content);
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

  // 4. Consolidate: create / merge / link.
  const out = consolidate(input.ownerId, accepted, experience.id);

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
