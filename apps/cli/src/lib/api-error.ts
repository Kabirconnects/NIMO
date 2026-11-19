import { ApiError } from "./api-client";

/**
 * Turn an API/client failure into a message fit for the terminal.
 *
 * The server always answers `{ success: false, error }`, so that message is
 * preferred over a generic "request failed".
 */
export function getApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof ApiError) {
    if (error.status === 0 || error.message.startsWith("Cannot reach")) {
      return error.message;
    }

    if (error.message.trim().length > 0) return error.message;
    return fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
