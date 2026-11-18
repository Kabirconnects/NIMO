import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/ui/card"

import { useSession } from "../hooks/use-session"
import { LoginForm } from "./login-form"
import { RegisterForm } from "./register-form"

export type AuthMode = "login" | "register"

interface AuthPageProps {
  /** Which screen to show; `/login` and `/register` both render this page. */
  mode?: AuthMode
}

export function AuthPage({ mode = "login" }: AuthPageProps) {
  const navigate = useNavigate()
  const { data: user, isPending } = useSession()

  // Someone with a valid cookie has no business on the auth screens.
  useEffect(() => {
    if (!isPending && user) {
      navigate("/", { replace: true })
    }
  }, [isPending, user, navigate])

  // The route is the only source of truth, so switching screens is a plain
  // navigation — no local state to keep in sync.
  const isLogin = mode === "login"

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{isLogin ? "Welcome back" : "Create an account"}</CardTitle>
          <CardDescription>
            {isLogin
              ? "Sign in to continue to Nimo."
              : "Start chatting with Nimo in a few seconds."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {isLogin ? (
            <LoginForm
              onSuccess={() => navigate("/", { replace: true })}
              onSwitchToRegister={() => navigate("/register")}
            />
          ) : (
            <RegisterForm
              onSuccess={() => navigate("/", { replace: true })}
              onSwitchToLogin={() => navigate("/login")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
