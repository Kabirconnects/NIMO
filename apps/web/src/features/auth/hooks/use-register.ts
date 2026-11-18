import { useMutation, useQueryClient } from "@tanstack/react-query"
import apiClient from "@/lib/api-client"

import { sessionQueryKey } from "./use-session"
import type { AuthResponse, RegisterInput, User } from "../types"

function useRegister() {
  const queryClient = useQueryClient()

  return useMutation({
    // Signup is `POST /users` (the `createUser` controller), not `/auth/register`.
    mutationFn: async (data: RegisterInput): Promise<User> => {
      const response = await apiClient.post<AuthResponse>("/users", data)

      // Cache the user, not the wrapper: `useSession()` consumers read a `User`.
      return response.data.user
    },
    onSuccess: (user) => {
      queryClient.setQueryData(sessionQueryKey, user)
    },
  })
}

export { useRegister }
export default useRegister
