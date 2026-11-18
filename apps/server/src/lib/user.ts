import type { AuthUser } from "../types/auth.js"

/** The user fields needed to build the public representation. */
type UserLike = {
  _id: unknown
  name: string
  email: string
  role: string
  isActive: boolean
}

/**
 * Map a Mongoose user document to the public `AuthUser` shape.
 *
 * `select: false` only filters queries, so documents returned by `create()` or
 * `save()` still carry `passwordHash` — never send a raw document to a client.
 */
export function toPublicUser(user: UserLike): AuthUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    isActive: user.isActive,
  }
}
