import axios from "axios"

/** Error body used by every endpoint of the API. */
export interface ApiErrorBody {
  success: false
  error: string
  details?: unknown
}

/**
 * Turn an API/axios failure into a message fit for the UI.
 *
 * The server always answers `{ success: false, error }`, so that message is
 * preferred over axios' generic "Request failed with status code 409".
 */
export function getApiErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again."
): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const message = error.response?.data?.error

    if (typeof message === "string" && message.length > 0) {
      return message
    }

    if (!error.response) {
      return "Cannot reach the server. Check your connection and try again."
    }

    return fallback
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}
