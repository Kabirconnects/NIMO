import { useMutation, useQueryClient } from "@tanstack/react-query"
import apiClient from "@/lib/api-client"

import { sessionQueryKey } from "./use-session"
import type { AuthResponse, LoginInput, User } from "../types"

function useLogin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: LoginInput): Promise<User> => {
      const response = await apiClient.post<AuthResponse>("/users/login", data)

      // Cache the user, not the wrapper: `useSession()` consumers read a `User`.
      return response.data.user
    },
    onSuccess: (user) => {
      queryClient.setQueryData(sessionQueryKey, user)
    },
  })
}

export { useLogin }
export default useLogin
