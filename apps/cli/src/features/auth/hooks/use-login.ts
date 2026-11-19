import { useCallback, useState } from "react";

import { apiRequest } from "../../../lib/api-client";
import { getApiErrorMessage } from "../../../lib/api-error";
import { setSessionUser } from "./use-session";
import type { AuthResponse, LoginInput, User } from "../types";

function useLogin() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => setError(null), []);

  const mutate = useCallback(
    async (input: LoginInput): Promise<User | null> => {
      setIsPending(true);
      setError(null);

      try {
        const response = await apiRequest<AuthResponse>("/users/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        setSessionUser(response.user);
        return response.user;
      } catch (cause) {
        setError(new Error(getApiErrorMessage(cause, "Unable to sign in.")));
        return null;
      } finally {
        setIsPending(false);
      }
    },
    [],
  );

  return { mutate, isPending, error, reset };
}

export { useLogin };
export default useLogin;
