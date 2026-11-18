import { useMutation, useQueryClient } from "@tanstack/react-query"
import apiClient from "@/lib/api-client"

import { sessionQueryKey } from "./use-session"

function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await apiClient.post("/users/logout")
    },
    // The server already cleared the cookie; mirror that locally so no guarded
    // screen keeps rendering a stale user.
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null)
    },
  })
}

export { useLogout }
export default useLogout
