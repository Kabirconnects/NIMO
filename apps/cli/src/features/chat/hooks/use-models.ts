import { useCallback, useEffect, useRef, useState } from "react";

import { apiRequest, ApiError } from "../../../lib/api-client";
import type { ModelsResponse } from "../types";

type UseModelsResult = {
  data: ModelsResponse | null;
  error: Error | null;
  isPending: boolean;
  reload: () => void;
};

/**
 * The model catalog lives on the server so the picker always matches the ids
 * the agent can actually run.
 */
function useModels(): UseModelsResult {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isPending, setIsPending] = useState(true);
  const requestRef = useRef(0);

  const reload = useCallback(() => {
    const requestId = ++requestRef.current;
    setIsPending(true);
    setError(null);

    apiRequest<ModelsResponse>("/agent/models")
      .then((response) => {
        if (requestRef.current !== requestId) return;

        // A 200 that is not the catalog (an HTML index page, a proxy error
        // page, an older API) would otherwise render an empty picker.
        if (
          !response ||
          typeof response !== "object" ||
          !Array.isArray(response.groups) ||
          typeof response.defaultModelId !== "string"
        ) {
          throw new ApiError(
            "The API returned an unexpected model catalog. Check that NIMO_API_URL points at the Nimo API.",
          );
        }

        setData(response);
      })
      .catch((cause: unknown) => {
        if (requestRef.current !== requestId) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (requestRef.current !== requestId) return;
        setIsPending(false);
      });
  }, []);

  useEffect(() => {
    reload();

    return () => {
      // Invalidate any in-flight request when the chat unmounts.
      requestRef.current += 1;
    };
  }, [reload]);

  return { data, error, isPending, reload };
}

export { useModels };
export default useModels;
