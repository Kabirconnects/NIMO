import { z } from "zod"

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(8).max(128),
  role: z.enum(["user", "admin"]).optional(),
})

/**
 * Login accepts whatever the signup rules allow, so it must not re-apply the
 * `min(8)` password policy — an account created before a policy change would
 * otherwise fail validation with a 400 instead of a normal 401.
 *
 * The email is normalized exactly like `createUserSchema` so the lookup matches
 * the lowercase value stored by the `email` field in `usersSchema`.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  password: z.string().min(1).max(128),
})

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(8).max(128),
    role: z.enum(["user", "admin"]),
    isActive: z.boolean(),
  })
  .partial()

export type CreateUserInput = z.infer<typeof createUserSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>

