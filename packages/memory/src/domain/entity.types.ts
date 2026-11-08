// domain/entity.types.ts
// Canonical entities so "Nimo", "Nimo project", and "the agent harness" can
// resolve to the same thing — as an alias merge, not silent rewrites.

export type EntityType =
  | "person"
  | "project"
  | "technology"
  | "organization"
  | "concept"
  | "product"
  | "place";

export interface MemoryEntity {
  id: string;
  ownerId: string;

  canonicalName: string;
  aliases: string[];
  type: EntityType;

  description?: string;

  createdAt: Date;
  updatedAt: Date;
}
