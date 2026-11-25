import { useQuery } from "@tanstack/react-query"
import axios from "axios"

import apiClient from "@/lib/api-client"
import type { AuthResponse, User } from "../types"
import { determineSessionState } from "../utils/session-state"

export const sessionQueryKey = ["auth", "session"] as const

function useSession() {
  const query = useQuery<User | null>({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      try {
        const response = await apiClient.get<AuthResponse>("/users/me")

        return response.data.user
      } catch (error) {
        // A guest has no cookie (401) and a disabled account gets 403. Neither
        // is worth showing — both simply mean "not signed in".
        if (axios.isAxiosError(error)) {
          const status = error.response?.status

          if (status === 401 || status === 403) {
            return null
          }
        }

        throw error
      }
    },
    // A guest's 401 must resolve to `null` instead of being retried.
    retry: (failureCount, error) => {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status
        if (status === 401 || status === 403) {
          return false
        }
      }
      return failureCount < 3
    },
    staleTime: 60_000,
  })

  const sessionState = determineSessionState(
    query.isPending,
    query.isError,
    query.error,
    query.data
  )

  return {
    ...query,
    sessionState,
  }
}

export { useSession }
export default useSession
