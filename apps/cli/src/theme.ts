/**
 * Shared terminal palette.
 *
 * Before this file the palette existed in two components; keeping it in one
 * place means the header, menus, and messages cannot drift apart.
 */
export const COLORS = {
  brand: "#D77757",
  brandDark: "#8A4A33",
  accent: "#F0B49A",
  border: "#B0654A",
  text: "#E6E6E6",
  dim: "#999999",
  muted: "#666666",
  faint: "#4A4A4A",
  background: "#1A1A1A",
  panel: "#202020",
  selection: "#D77757",
  selectionText: "#1A1A1A",
  success: "#7FCF8F",
  error: "#E06C75",
  warning: "#E5C07B",
} as const;
