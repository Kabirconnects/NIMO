// governance/forget.ts
// Deletion is a graph operation, not a single-row delete:
//   remove edges -> redact revision bodies -> redact exclusive experiences
//   -> redact the memory row itself (content, summary, embedding, evidence)
//   -> record a non-sensitive audit entry.
//
// Everything runs in one transaction, so a crash cannot leave a half-deleted
// memory. The operation is idempotent: calling it again re-runs the cleanup
// and does not append a duplicate audit entry.
//
// Bulk deletion (`forgetByQuery`) defaults to a PREVIEW. It never deletes and
// never includes graph-only neighbours — only memories whose own text matches
// the query terms. Deletion requires an explicit `{ confirm: true }`.

import type { MemoryNode } from "../domain/memory.types.js";
import type {
  ForgetByQueryOptions,
  ForgetByQueryResult,
  ForgetMatch,
} from "../domain/service.types.js";
import {
  findMemory,
  redactMemoryRow,
  deleteEdgesForMemory,
  redactRevisionsForMemory,
  redactExperience,
  isExperienceReferenced,
  recordAudit,
  listActiveMemories,
  withTransaction,
} from "../storage/db.js";

export function forgetMemory(memoryId: string, ownerId: string): void {
  const node = findMemory(memoryId, ownerId);
  if (!node) return; // nothing to do

  const alreadyDeleted = node.status === "deleted";

  withTransaction(() => {
    // 1) Remove graph edges in both directions and repair endpoint degrees.
    deleteEdgesForMemory(memoryId, ownerId);

    // 2) Revision history keeps only a redacted shell — no secret or PII can
    //    survive in an old revision body.
    redactRevisionsForMemory(memoryId, ownerId);

    // 3) Experiences are provenance, but a raw turn may still contain the
    //    deleted fact. Redact an experience only when this memory is its last
    //    non-deleted referrer; shared provenance is preserved.
    for (const ev of node.evidence) {
      if (!ev.experienceId) continue;
      if (!isExperienceReferenced(ev.experienceId, ownerId, memoryId)) {
        redactExperience(ev.experienceId, ownerId);
      }
    }

    // 4) Redact the row itself. Status becomes "deleted"; nothing readable
    //    remains in content, summary, keywords, evidence, or embedding.
    redactMemoryRow(memoryId, ownerId);

    if (!alreadyDeleted) {
      recordAudit({
        ownerId,
        actor: "user",
        action: "delete",
        targetId: memoryId,
        reason: "forget requested",
      });
    }
  });
}

// ---- bulk deletion (preview by default) ----

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "is", "are", "was", "were", "be", "been", "it", "this", "that", "my",
  "me", "i", "we", "you", "your", "our", "please", "forget", "delete",
  "remove", "about", "all", "any",
]);

function queryTokens(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  )];
}

function haystack(node: MemoryNode): string {
  return [
    node.content,
    node.summary,
    ...node.keywords,
    ...node.tags,
    ...node.concepts,
  ]
    .join(" ")
    .toLowerCase();
}

/** Direct textual match only — never graph neighbours. */
function directMatches(ownerId: string, query: string): MemoryNode[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [];
  const required = Math.max(1, Math.ceil(tokens.length / 2));
  const all = listActiveMemories(ownerId, { limit: 100_000 });
  const out: { node: MemoryNode; hits: number }[] = [];
  for (const node of all) {
    const text = haystack(node);
    let hits = 0;
    for (const t of tokens) if (text.includes(t)) hits++;
    if (hits >= required) out.push({ node, hits });
  }
  out.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    return b.node.updatedAt.getTime() - a.node.updatedAt.getTime();
  });
  return out.map((x) => x.node);
}

export function forgetByQuery(
  ownerId: string,
  query: string,
  options: ForgetByQueryOptions = {},
): ForgetByQueryResult {
  const limit = Math.max(1, options.limit ?? 50);
  const all = directMatches(ownerId, query);
  const truncated = all.length > limit;
  const matches = all.slice(0, limit).map((n) => ({
    id: n.id,
    type: n.type,
    content: n.content,
  }));

  if (options.confirm !== true) {
    return { query, preview: true, matches, deleted: 0, truncated };
  }

  withTransaction(() => {
    for (const m of matches) forgetMemory(m.id, ownerId);
  });

  return { query, preview: false, matches, deleted: matches.length, truncated };
}
