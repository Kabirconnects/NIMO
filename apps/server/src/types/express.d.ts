import type { AuthUser } from "./auth.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth after a valid session cookie is verified. */
      user?: AuthUser;
    }
  }
}

export {};
