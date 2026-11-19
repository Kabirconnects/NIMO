import { useCallback, useState } from "react";

import { apiRequest } from "../../../lib/api-client";
import { setSessionUser } from "./use-session";

function useLogout() {
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(async (): Promise<void> => {
    setIsPending(true);

    try {
      await apiRequest("/users/logout", { method: "POST" });
    } catch {
      // Idempotent on the server; drop the local session either way so a stale
      // cookie cannot keep rendering a signed-in shell.
    } finally {
      setSessionUser(null);
      setIsPending(false);
    }
  }, []);

  return { mutate, isPending };
}

export { useLogout };
export default useLogout;
