export type SessionState =
  | { status: "loading" }
  | { status: "authenticated"; user: any }
  | { status: "unauthenticated" }
  | { status: "error"; error: unknown };

export function determineSessionState(
  isLoading: boolean,
  isError: boolean,
  error: unknown,
  user: any
): SessionState {
  if (isLoading) {
    return { status: "loading" };
  }
  if (isError) {
    // Check if error is a 401 or 403 response error (unauthenticated / unauthorized)
    const isAuthError =
      error !== null &&
      typeof error === "object" &&
      "response" in error &&
      error.response !== null &&
      typeof error.response === "object" &&
      "status" in error.response &&
      (error.response.status === 401 || error.response.status === 403);

    if (isAuthError) {
      return { status: "unauthenticated" };
    }

    return { status: "error", error };
  }
  if (!user) {
    return { status: "unauthenticated" };
  }
  return { status: "authenticated", user };
}
