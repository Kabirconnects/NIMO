/**
 * Unit tests for session-state module.
 * Runs with `tsx apps/web/scripts/web-test.ts` or similar test runner.
 */

import { determineSessionState } from "./session-state.js";

export function runSessionStateTests(assert: (label: string, condition: boolean) => void) {
  console.log("determineSessionState");

  // Loading state
  const loadingResult = determineSessionState(true, false, null, null);
  assert("loading state returns loading", loadingResult.status === "loading");

  // Authenticated state
  const authResult = determineSessionState(false, false, null, { id: "1", email: "test@example.com" });
  assert("authenticated state returns authenticated with user", authResult.status === "authenticated" && authResult.user?.id === "1");

  // Unauthenticated via !user
  const unauthResult = determineSessionState(false, false, null, null);
  assert("no user returns unauthenticated", unauthResult.status === "unauthenticated");

  // Unauthenticated via 401 error
  const axios401Error = { response: { status: 401 } };
  const err401Result = determineSessionState(false, true, axios401Error, null);
  assert("401 error returns unauthenticated", err401Result.status === "unauthenticated");

  // Unauthenticated via 403 error
  const axios403Error = { response: { status: 403 } };
  const err403Result = determineSessionState(false, true, axios403Error, null);
  assert("403 error returns unauthenticated", err403Result.status === "unauthenticated");

  // Transient 5xx error (should NOT be unauthenticated, should be error)
  const axios500Error = { response: { status: 500 } };
  const err500Result = determineSessionState(false, true, axios500Error, null);
  assert("500 server error returns error status (not unauthenticated)", err500Result.status === "error");

  // Network error (no response)
  const networkError = new Error("Network Error");
  const netErrResult = determineSessionState(false, true, networkError, null);
  assert("Network error returns error status", netErrResult.status === "error");
}
