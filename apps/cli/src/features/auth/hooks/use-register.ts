import { useCallback, useState } from "react";

import { apiRequest } from "../../../lib/api-client";
import { getApiErrorMessage } from "../../../lib/api-error";
import { setSessionUser } from "./use-session";
import type { AuthResponse, RegisterInput, User } from "../types";

function useRegister() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const reset = useCallback(() => setError(null), []);

  const mutate = useCallback(
    async (input: RegisterInput): Promise<User | null> => {
      setIsPending(true);
      setError(null);

      try {
        // Signup is `POST /users` (the `createUser` controller).
        const response = await apiRequest<AuthResponse>("/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });

        setSessionUser(response.user);
        return response.user;
      } catch (cause) {
        setError(
          new Error(getApiErrorMessage(cause, "Unable to create the account.")),
        );
        return null;
      } finally {
        setIsPending(false);
      }
    },
    [],
  );

  return { mutate, isPending, error, reset };
}

export { useRegister };
export default useRegister;
