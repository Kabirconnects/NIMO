// Request identity resolution for the agent API.
//
// This module does NOT invent an authentication scheme. It consumes the
// identity that an existing auth middleware would attach to `req.user`
// (`id` or `ownerId`). Two deployment modes:
//
//   1. Multi-user (PAME_MULTI_USER=true): an authenticated identity is
//      REQUIRED. Missing identity → 401. There is no shared "local" bucket.
//   2. Local dev (default): a deliberate single-user mode uses PAME_OWNER_ID
//      (or "local"). This is the local desktop/server case.
//
// Never trust an owner id from the request body or a client header.

import type { Request } from "express";
import { isMultiUserDeployment, localOwnerId } from "@workspace/memory";

export interface RequestIdentity {
  ownerId: string;
  multiUser: boolean;
}

export class IdentityError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

export function resolveRequestIdentity(req: Request): RequestIdentity {
  const authUser = (req as unknown as {
    user?: { id?: unknown; ownerId?: unknown };
  }).user;

  const candidate = authUser?.id ?? authUser?.ownerId;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return { ownerId: candidate.trim(), multiUser: isMultiUserDeployment() };
  }

  if (isMultiUserDeployment()) {
    throw new IdentityError(
      "Authentication required: this deployment is multi-user and no identity was attached to the request.",
    );
  }

  return { ownerId: localOwnerId(), multiUser: false };
}
