// governance/audit.ts
// Thin wrapper so callers don't import the storage layer directly.

import type { MemoryAuditEntry } from "../domain/governance.types.js";
import { recordAudit as writeAudit } from "../storage/db.js";

export function recordAudit(entry: Omit<MemoryAuditEntry, "id" | "createdAt">): void {
  writeAudit(entry);
}
