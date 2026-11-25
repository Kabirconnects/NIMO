import { useMutation, useQueryClient } from "@tanstack/react-query"
import apiClient from "@/lib/api-client"

import { clearSessionCache } from "../utils/clear-session-cache"

function useLogout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await apiClient.post("/users/logout")
    },
    // The server already cleared the cookie; mirror that locally so no guarded
    // screen keeps rendering a stale user.
    onSuccess: () => {
      clearSessionCache(queryClient)
    },
    onError: () => {
      clearSessionCache(queryClient)
    },
  })
}

export { useLogout }
export default useLogout
