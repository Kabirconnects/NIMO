import bcrypt from "bcrypt"

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12)
  const hash = await bcrypt.hash(password, salt)
  return hash
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<Boolean> {
  const v = bcrypt.compare(password, passwordHash)
  return v
}
