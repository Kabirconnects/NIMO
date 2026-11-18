import { useQuery } from "@tanstack/react-query"

import apiClient from "@/lib/api-client"
import type { ModelsResponse } from "../types"

export const modelsQueryKey = ["agent", "models"] as const

/**
 * The model catalog lives on the server so the picker always matches the ids
 * the agent can actually run — no more hand-maintained list in the web app.
 */
function useModels() {
  return useQuery<ModelsResponse>({
    queryKey: modelsQueryKey,
    queryFn: async () => {
      const response = await apiClient.get<ModelsResponse>("/agent/models")

      return response.data
    },
    // The catalog only changes when the server restarts with different env.
    staleTime: 5 * 60_000,
  })
}

export { useModels }
export default useModels
