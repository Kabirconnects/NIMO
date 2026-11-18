import type { NextFunction, Request, Response } from "express"
import { User } from "@workspace/db"
import { TOKEN_COOKIE_NAME, verifyToken } from "../lib/token.js"
import { toPublicUser } from "../lib/user.js"

/**
 * Require a valid session cookie.
 *
 * On success the authenticated user is attached to `req.user` as `AuthUser`
 * and the request continues; on failure the request is answered directly.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = req.cookies?.[TOKEN_COOKIE_NAME]

  if (typeof token !== "string" || token.length === 0) {
    res.status(401).json({ success: false, error: "Unauthorized" })
    return
  }

  let userId: string

  try {
    userId = await verifyToken(token)
  } catch {
    // Expired, tampered with or signed with another secret — expected noise.
    res.status(401).json({ success: false, error: "Invalid or expired session" })
    return
  }

  try {
    // `passwordHash` is already `select: false`; choose the session fields
    // explicitly so nothing else can leak into `req.user`.
    const user = await User.findById(userId).select("name email role isActive")

    if (!user) {
      res.status(401).json({ success: false, error: "Unauthorized" })
      return
    }

    if (!user.isActive) {
      res.status(403).json({ success: false, error: "Account is disabled" })
      return
    }

    req.user = toPublicUser(user)

    next()
  } catch (error) {
    // Database failures are not auth failures — let the error handler report them.
    next(error)
  }
}
