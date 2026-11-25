import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { Spinner } from "@workspace/ui/components/ui/spinner"

import { useSession } from "../hooks/use-session"

interface ProtectedRouteProps {
  children: ReactNode
}

/**
 * Renders `children` only for a signed-in user.
 *
 * The session is fetched once per app; redirecting while it is still loading
 * would bounce a valid user to /login on every refresh.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { sessionState } = useSession()

  if (sessionState.status === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (sessionState.status === "error") {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
        <div className="max-w-md space-y-2">
          <h2 className="text-lg font-semibold">Unable to verify session</h2>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t reach the server or verify your session due to a temporary issue. Please check your connection or try again.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Try again
        </button>
      </div>
    )
  }

  if (sessionState.status === "unauthenticated") {
    return <Navigate to="/login" replace />
  }

  return children
}
