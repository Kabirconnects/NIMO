import type { ModelOption } from "./types";

/** Used only until the catalog finishes loading. */
export const FALLBACK_MODEL_ID = "anthropic/claude-sonnet-4-5";

/**
 * Pick the model the next turn should use.
 *
 * A saved model can go stale: the provider key was removed, the model was
 * renamed, or the catalog belongs to another install. Sending it anyway fails
 * with "Model X is not configured", so the first model the server can actually
 * run wins.
 */
export function resolveActiveModel(
  savedModelId: string | undefined,
  allModels: ModelOption[],
  defaultModelId: string | undefined,
): string {
  // Without a catalog there is nothing to validate against: keep the saved
  // value and let the server answer if it is wrong.
  if (allModels.length === 0) return savedModelId ?? defaultModelId ?? FALLBACK_MODEL_ID;

  if (savedModelId) {
    const saved = allModels.find((model) => model.id === savedModelId);
    if (saved?.configured) return savedModelId;
  }

  const preferred = defaultModelId ?? FALLBACK_MODEL_ID;
  const preferredModel = allModels.find(
    (model) => model.id === preferred && model.configured,
  );
  if (preferredModel) return preferredModel.id;

  const firstConfigured = allModels.find((model) => model.configured);
  return firstConfigured?.id ?? preferred;
}
