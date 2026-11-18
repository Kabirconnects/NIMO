import { useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/ui/field"
import { Alert, AlertDescription } from "@workspace/ui/components/ui/alert"
import { Input } from "@workspace/ui/components/ui/input"
import { Spinner } from "@workspace/ui/components/ui/spinner"

import { getApiErrorMessage } from "@/lib/api-error"
import { useLogin } from "../hooks/use-login"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface LoginFormProps {
  /** Runs after the session cookie is set. */
  onSuccess?: () => void
  onSwitchToRegister?: () => void
}

export function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<{ email?: string; password?: string }>(
    {}
  )

  const login = useLogin()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors: typeof errors = {}

    if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Enter a valid email address."
    }

    if (password.length === 0) {
      nextErrors.password = "Enter your password."
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) return

    login.mutate(
      { email: email.trim().toLowerCase(), password },
      { onSuccess: () => onSuccess?.() }
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="login-email">Email</FieldLabel>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            disabled={login.isPending}
            aria-invalid={Boolean(errors.email)}
            onChange={(event) => setEmail(event.target.value)}
          />
          {errors.email && <FieldError>{errors.email}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.password)}>
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={login.isPending}
            aria-invalid={Boolean(errors.password)}
            onChange={(event) => setPassword(event.target.value)}
          />
          {errors.password && <FieldError>{errors.password}</FieldError>}
        </Field>
      </FieldGroup>

      {login.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {getApiErrorMessage(login.error)}
          </AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={login.isPending}
        aria-busy={login.isPending}
      >
        {login.isPending && <Spinner />}
        Sign in
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToRegister}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create one
        </button>
      </p>
    </form>
  )
}
