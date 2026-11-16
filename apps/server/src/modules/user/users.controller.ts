import type { Request, Response } from "express"
import { createUserSchema, type CreateUserInput } from "./users.schema.js"
import { User } from "@workspace/db"
import { hashPassword } from "./users.service.js"

export async function listUsers(req: Request, res: Response): Promise<void> {
  try {
    // TODO: implement
  } catch (error) {
    console.error("Failed to list users:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function getUserById(req: Request, res: Response): Promise<void> {
  try {
    // TODO: implement
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

    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: "user",
    })

    res.status(201).json({ success: true, user })
    return
  } catch (error) {
    console.error("Failed to create user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

// ---------------------------------------------------------------------------------------------------------------

export async function login(req: Request, res: Response): Promise<void> {
  try {
    // TODO: implement
  } catch (error) {
    console.error("Failed to log in:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  try {
    // TODO: implement
  } catch (error) {
    console.error("Failed to log out:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    // TODO: implement
  } catch (error) {
    console.error("Failed to load current user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  try {
    // TODO: implement
  } catch (error) {
    console.error("Failed to update user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  try {
    // TODO: implement
  } catch (error) {
    console.error("Failed to delete user:", error)
    res.status(500).json({ success: false, error: "Internal server error" })
  }
}
