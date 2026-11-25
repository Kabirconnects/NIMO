import type { Request, Response, NextFunction } from "express"

interface RateLimitOptions {
  windowMs: number
  max: number
  keyGenerator?: (req: Request) => string
}

interface RateLimitEntry {
  count: number
  resetTime: number
}

export function rateLimit(options: RateLimitOptions) {
  const ipStore = new Map<string, RateLimitEntry>()
  const accountStore = new Map<string, RateLimitEntry>()

  // Cleanup interval to prevent memory leaks
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of ipStore.entries()) {
      if (now > entry.resetTime) {
        ipStore.delete(key)
      }
    }
    for (const [key, entry] of accountStore.entries()) {
      if (now > entry.resetTime) {
        accountStore.delete(key)
      }
    }
  }, 60000).unref()

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now()
    const ip = req.ip || req.socket.remoteAddress || "unknown"

    // Check IP rate limit
    let ipEntry = ipStore.get(ip)
    if (!ipEntry || now > ipEntry.resetTime) {
      ipEntry = { count: 0, resetTime: now + options.windowMs }
      ipStore.set(ip, ipEntry)
    }

    if (ipEntry.count >= options.max) {
      const retryAfter = Math.ceil((ipEntry.resetTime - now) / 1000)
      res.setHeader("Retry-After", retryAfter)
      res.status(429).json({
        success: false,
        error: "Too many login attempts from this IP, please try again later.",
      })
      return
    }

    // Check Account/Email rate limit if email is provided in request body
    const email = typeof req.body === "object" && req.body !== null && "email" in req.body && typeof req.body.email === "string"
      ? req.body.email.toLowerCase().trim()
      : null

    if (email) {
      let accountEntry = accountStore.get(email)
      if (!accountEntry || now > accountEntry.resetTime) {
        accountEntry = { count: 0, resetTime: now + options.windowMs }
        accountStore.set(email, accountEntry)
      }

      if (accountEntry.count >= options.max) {
        const retryAfter = Math.ceil((accountEntry.resetTime - now) / 1000)
        res.setHeader("Retry-After", retryAfter)
        res.status(429).json({
          success: false,
          error: "Too many login attempts for this account, please try again later.",
        })
        return
      }

      accountEntry.count++
    }

    ipEntry.count++
    next()
  }
}
