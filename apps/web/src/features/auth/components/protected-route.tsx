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
  const { data: user, isPending } = useSession()

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
