// ingestion/capture.ts
// Stage 1: persist the raw experience. No LLM, no extraction yet — extraction
// and consolidation are Stage 2.

import type { Experience, ExperienceType } from "../domain/experience.types.js";
import { captureExperience } from "../storage/db.js";

export interface CaptureInput {
  ownerId: string;
  content: string;
  type: ExperienceType;
  messageId?: string;
  occurredAt?: Date;
}

export function capture(input: CaptureInput): Experience {
  return captureExperience({
    ownerId: input.ownerId,
    content: input.content,
    type: input.type,
    messageId: input.messageId,
    occurredAt: input.occurredAt,
  });
}
