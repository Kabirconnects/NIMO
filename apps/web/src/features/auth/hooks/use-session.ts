import { useQuery } from "@tanstack/react-query"
import axios from "axios"

import apiClient from "@/lib/api-client"
import type { AuthResponse, User } from "../types"

export const sessionQueryKey = ["auth", "session"] as const

function useSession() {
  return useQuery<User | null>({
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
    retry: false,
    staleTime: 60_000,
  })
}

export { useSession }
export default useSession
