import { useSyncExternalStore } from "react";

import { apiRequest, ApiError } from "../../../lib/api-client";
import type { AuthResponse, User } from "../types";

type SessionState = {
  user: User | null;
  isPending: boolean;
  error: Error | null;
};

const listeners = new Set<() => void>();

let state: SessionState = {
  user: null,
  isPending: true,
  error: null,
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SessionState {
  return state;
}

function publish(next: Partial<SessionState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export function setSessionUser(user: User | null): void {
  publish({ user, isPending: false, error: null });
}

/** Load (or reload) the current session from `GET /users/me`. */
export async function refreshSession(): Promise<User | null> {
  publish({ isPending: true, error: null });

  try {
    const response = await apiRequest<AuthResponse>("/users/me");
    setSessionUser(response.user);
    return response.user;
  } catch (error) {
    // A guest has no cookie (401) and a disabled account gets 403. Both simply
    // mean "not signed in"; a network failure is worth reporting separately.
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      setSessionUser(null);
      return null;
    }

    const normalized = error instanceof Error ? error : new Error(String(error));
    publish({ user: null, isPending: false, error: normalized });
    return null;
  }
}

export function useSession() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    user: snapshot.user,
    isPending: snapshot.isPending,
    error: snapshot.error,
    refresh: refreshSession,
  };
}

export default useSession;
