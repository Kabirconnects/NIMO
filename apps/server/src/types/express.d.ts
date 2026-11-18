import type { AuthUser } from "./auth.js"

declare global {
  namespace Express {
    interface Request {
      /** Set by `authMiddleware` once a valid session cookie is verified. */
      user?: AuthUser
    }
  }
}

export {}


