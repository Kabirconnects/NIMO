import { LogOut, Moon, Sun, UserRound } from "lucide-react"
import { useTheme } from "next-themes"
import { useNavigate } from "react-router-dom"
import { Button } from "@workspace/ui/components/button"
import { Avatar, AvatarFallback } from "@workspace/ui/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/ui/dropdown-menu"
import { SidebarTrigger } from "@workspace/ui/components/ui/sidebar"
import { Skeleton } from "@workspace/ui/components/ui/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import { useLogout, useSession } from "@/features/auth"
import { initials } from "@/lib/initials"

export function Header({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const navigate = useNavigate()
  const { data: user, isPending } = useSession()
  const logout = useLogout()

  function handleLogout() {
    // Navigate even if the request fails: the cookie is cleared server-side in
    // the happy path, and the local session cache is dropped either way.
    logout.mutate(undefined, {
      onSettled: () => navigate("/login", { replace: true }),
    })
  }

  return (
    <header
      className={cn(
        " bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/60",
        className
      )}
    >
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-1 text-foreground dark:text-foreground">
          <SidebarTrigger />
        </div>

        <nav className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-accent-foreground"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>

          {/* Session unknown yet: show a placeholder instead of flashing
              "Sign in" at a user who is already authenticated. */}
          {isPending ? (
            <Skeleton className="h-8 w-24 rounded-lg" />
          ) : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Account menu for ${user.name}`}
                className="flex items-center gap-2 rounded-lg p-1 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:bg-muted"
              >
                <Avatar className="size-7">
                  <AvatarFallback className="text-xs">
                    {initials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-32 truncate font-medium sm:inline">
                  {user.name}
                </span>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                {/* Base UI's GroupLabel throws unless it sits inside a Group. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{user.name}</span>
                        {user.role === "admin" && (
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
                            Admin
                          </span>
                        )}
                      </div>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {user.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>

                  <DropdownMenuItem onClick={() => navigate("/profile")}>
                    <UserRound className="size-4" />
                    Profile
                  </DropdownMenuItem>
                </DropdownMenuGroup>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={handleLogout}
                  disabled={logout.isPending}
                >
                  <LogOut className="size-4" />
                  {logout.isPending ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/login")}
                className="text-muted-foreground hover:bg-muted hover:text-foreground dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
              >
                Sign in
              </Button>
              <Button
                size="sm"
                onClick={() => navigate("/register")}
                className="bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
              >
                Get started
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
