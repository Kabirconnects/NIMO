/** "Ada Lovelace" -> "AL", "nimo" -> "N", "" -> "?". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const letters = parts.map((part) => part.charAt(0).toUpperCase()).join("")

  return letters.length > 0 ? letters : "?"
}
