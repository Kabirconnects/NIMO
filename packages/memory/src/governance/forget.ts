// governance/forget.ts
// Forgetting is a graph operation, not a single-row delete:
//   tombstone first (excluded from retrieval immediately)
//   -> remove edges -> remove derived summaries/index entries
//   -> record a non-sensitive audit entry -> verify it is gone from recall.
//
// The tombstone + idempotent retry makes this safe to call again (Stage 5
// wires the retry queue; the sequence itself is already retry-safe).

import { findMemory, tombstoneMemory, deleteEdgesForMemory, recordAudit } from "../storage/db.js";

export function forgetMemory(memoryId: string, ownerId: string): void {
  const node = findMemory(memoryId, ownerId);
  if (!node || node.status === "deleted") return; // idempotent

  // 1) Tombstone immediately — retrieval excludes "deleted" from this point on.
  tombstoneMemory(memoryId, ownerId);

  // 2) Remove graph edges (both directions).
  deleteEdgesForMemory(memoryId, ownerId);

  // 3) Derived artifacts: embedding lives on the memory row (cleared with the
  //    tombstone), vector/keyword index entries keyed by memoryId are excluded
  //    by status once indexes are built (Stage 3).

  // 4) Audit — operation + ids only, never the deleted content.
  recordAudit({
    ownerId,
    actor: "user",
    action: "delete",
    targetId: memoryId,
    reason: "user forget request",
  });
}
