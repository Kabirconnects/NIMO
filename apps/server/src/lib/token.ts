import type { Response } from "express"
import { SignJWT, jwtVerify } from "jose"
import { env } from "./env.js"

/** Name of the httpOnly cookie that carries the session token. */
export const TOKEN_COOKIE_NAME = "jwt"

const ALGORITHM = "HS256"

/** Session lifetime in seconds. Keep in sync with the cookie maxAge below. */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60

const secret = new TextEncoder().encode(env.JWT_SECRET)

const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const

/** Sign a session token for `userId`, stored in the standard `sub` claim. */
export async function generateToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secret)
}

/**
 * Verify a session token and return the id of the user it belongs to.
 * Throws if the token is malformed, tampered with or expired.
 */
export async function verifyToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [ALGORITHM],
  })

  if (!payload.sub) {
    throw new Error("Invalid token payload")
  }

  return payload.sub
}

/** Store the session token in an httpOnly cookie. */
export function setTokenCookie(res: Response, token: string): void {
  res.cookie(TOKEN_COOKIE_NAME, token, {
    ...cookieOptions,
    maxAge: TOKEN_TTL_SECONDS * 1000,
  })
}

/** Remove the session cookie. */
export function clearTokenCookie(res: Response): void {
  res.clearCookie(TOKEN_COOKIE_NAME, cookieOptions)
}
