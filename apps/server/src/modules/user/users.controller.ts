import type { Request, Response } from "express"
import {
  createUserSchema,
  type CreateUserInput,
  loginSchema,
  type LoginInput,
} from "./users.schema.js"
import { User } from "@workspace/db"
import { hashPassword, verifyPassword } from "./users.service.js"
import { isDuplicateKeyError } from "../../lib/mongo-errors.js"
import { toPublicUser } from "../../lib/user.js"
import { generateToken, setTokenCookie, clearTokenCookie } from "../../lib/token.js"

export async function listUsers(req: Request, res: Response): Promise<void> {
  try {
    res.status(501).json({ success: false, error: "Listing users is not available in this build" })
    return
  } catch (error) {
    console.error("Failed to list users:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

// ---------------------------------------------------------------------------------------------------------------

export async function getUserById(req: Request, res: Response): Promise<void> {
  try {
    res.status(501).json({ success: false, error: "Getting user details is not available in this build" })
    return
  } catch (error) {
    console.error("Failed to get user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

// ---------------------------------------------------------------------------------------------------------------

export async function createUser(req: Request, res: Response): Promise<void> {
  try {
    const result = createUserSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: "Invalid user data",
        details: result.error.flatten(),
      })
      return
    }

    const input: CreateUserInput = result.data
    const passwordHash = await hashPassword(input.password)

    // Signup may never choose its own role: `role` in the body is ignored and
    // every self-registered account starts as "user".
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: "user",
    })

    // Generate JWT
    const token = await generateToken(user._id.toString())

    // Set HTTP-only cookie
    setTokenCookie(res, token)

    res.status(201).json({ success: true, user: toPublicUser(user) })
    return
  } catch (error) {
    // The unique index on `email` is the source of truth (and beats the race
    // between two concurrent signups), so map its violation to 409.
    if (isDuplicateKeyError(error)) {
      res.status(409).json({
        success: false,
        error: "Email already registered",
      })
      return
    }

    console.error("Failed to create user:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const result = loginSchema.safeParse(req.body)

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: "Invalid user data",
        details: result.error.flatten(),
      })
      return
    }

    const input: LoginInput = result.data

    // `passwordHash` is `select: false` in the schema, so it must be requested
    // explicitly — otherwise `verifyPassword` receives `undefined` and bcrypt
    // throws ("data and hash arguments required"), turning every login into a 500.
    const user = await User.findOne({
      email: input.email,
    }).select("+passwordHash")

    const isPasswordValid = user
      ? await verifyPassword(input.password, user.passwordHash)
      : false

    // One message for "unknown email" and "wrong password" on purpose: telling
    // them apart lets anyone enumerate which accounts exist.
    if (!user || !isPasswordValid) {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      })
      return
    }

    // Checked only after the password is proven correct, so account state is
    // never leaked to someone who cannot log in anyway.
    if (!user.isActive) {
      res.status(403).json({ success: false, error: "Account is disabled" })
      return
    }

    user.lastLoginAt = new Date()
    await user.save()

    // Generate JWT
    const token = await generateToken(user._id.toString())

    // Set HTTP-only cookie
    setTokenCookie(res, token)

    res.status(200).json({ success: true, user: toPublicUser(user) })
    return
  } catch (error) {
    console.error("Failed to log in:", error)
    res.status(500).json({
      success: false,
      error: "Internal server error",
    })
  }
}

export async function logout(_req: Request, res: Response): Promise<void> {
  try {
    clearTokenCookie(res)

    // Idempotent on purpose: a client must be able to log out (drop a stale or
    // already expired cookie) without first proving it has a valid session.
    res.status(200).json({ success: true })
    return
  } catch (error) {
    console.error("Failed to log out:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    // `authMiddleware` already loaded the user and verified it is active, so
    // there is no second query to run here.
    if (!req.user) {
      res.status(401).json({ success: false, error: "Unauthorized" })
      return
    }

    res.status(200).json({ success: true, user: req.user })
    return
  } catch (error) {
    console.error("Failed to load current user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  try {
    res.status(501).json({ success: false, error: "Updating users is not available in this build" })
    return
  } catch (error) {
    console.error("Failed to update user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  try {
    res.status(501).json({ success: false, error: "Deleting users is not available in this build" })
    return
  } catch (error) {
    console.error("Failed to delete user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}
