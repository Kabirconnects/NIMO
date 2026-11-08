// domain/experience.types.ts
// The experience layer: evidence of what actually happened. Provenance for
// memories. Human memory has no sessions — experiences form one continuous
// stream, retrieved by content and connections, never by conversation bucket.

export type ExperienceType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "system_observation"
  | "external_document";

export interface Experience {
  id: string;
  ownerId: string;

  messageId?: string;

  type: ExperienceType;

  content: string;
  /** SHA-256 of content — used for duplicate detection at consolidation. */
  contentHash: string;

  occurredAt: Date;
  capturedAt: Date;

  metadata: Record<string, unknown>;
}
