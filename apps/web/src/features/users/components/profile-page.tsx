import { LogOut, Mail, ShieldCheck, UserRound } from "lucide-react"
import { Navigate, useNavigate } from "react-router-dom"
import { Button } from "@workspace/ui/components/button"
import { Avatar, AvatarFallback } from "@workspace/ui/components/ui/avatar"
import { Badge } from "@workspace/ui/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/ui/card"
import { Separator } from "@workspace/ui/components/ui/separator"
import { Spinner } from "@workspace/ui/components/ui/spinner"

import { useLogout, useSession } from "@/features/auth"
import { initials } from "@/lib/initials"

export function ProfilePage() {
  const navigate = useNavigate()
  const { data: user, isPending } = useSession()
  const logout = useLogout()

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  // The session can expire while the page is open.
  if (!user) {
    return <Navigate to="/login" replace />
  }

  function handleSignOut() {
    logout.mutate(undefined, {
      onSettled: () => navigate("/login", { replace: true }),
    })
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              <AvatarFallback className="text-base">
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <CardTitle className="truncate">{user.name}</CardTitle>
              <CardDescription className="truncate">
                {user.email}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <Separator />

          <dl className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <Mail className="size-4" />
                Email
              </dt>
              <dd className="min-w-0 truncate font-medium">{user.email}</dd>
            </div>

            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <UserRound className="size-4" />
                Role
              </dt>
              <dd>
                <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                  {user.role === "admin" ? "Admin" : "Member"}
                </Badge>
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="size-4" />
                Status
              </dt>
              <dd>
                <Badge variant={user.isActive ? "secondary" : "destructive"}>
                  {user.isActive ? "Active" : "Disabled"}
                </Badge>
              </dd>
            </div>
          </dl>

          <Separator />

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate("/")}
            >
              Back to chat
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleSignOut}
              disabled={logout.isPending}
            >
              <LogOut className="size-4" />
              {logout.isPending ? "Signing out…" : "Sign out"}
            </Button>
          </div>

          {/* `updateUser` is still a TODO on the server, so this page is read-only. */}
          <p className="text-center text-xs text-muted-foreground">
            Editing your profile is coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
