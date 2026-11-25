export const sessionQueryKey = ["auth", "session"] as const

export interface QueryClientLike {
  setQueryData(queryKey: readonly unknown[], data: unknown): unknown
}

export function clearSessionCache(queryClient: QueryClientLike): void {
  queryClient.setQueryData(sessionQueryKey, null)
}
