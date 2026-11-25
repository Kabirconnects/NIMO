/**
 * Unit tests for clear-session-cache module.
 * Runs with `tsx apps/web/scripts/web-test.ts`.
 */

import { clearSessionCache, sessionQueryKey } from "./clear-session-cache.js";

export function runClearSessionCacheTests(assert: (label: string, condition: boolean) => void) {
  console.log("clearSessionCache");

  let calledWithKey: readonly unknown[] | undefined;
  let calledWithValue: unknown;

  const fakeQueryClient = {
    setQueryData(key: readonly unknown[], value: unknown) {
      calledWithKey = key;
      calledWithValue = value;
    },
  };

  clearSessionCache(fakeQueryClient);

  assert("sets query data on sessionQueryKey", calledWithKey === sessionQueryKey);
  assert("sets session cache data to null", calledWithValue === null);
}
