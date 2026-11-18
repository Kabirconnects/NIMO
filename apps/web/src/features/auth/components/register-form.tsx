import { useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/ui/field"
import { Alert, AlertDescription } from "@workspace/ui/components/ui/alert"
import { Input } from "@workspace/ui/components/ui/input"
import { Spinner } from "@workspace/ui/components/ui/spinner"

import { getApiErrorMessage } from "@/lib/api-error"
import { useRegister } from "../hooks/use-register"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Mirrors `createUserSchema` on the server. */
const MIN_PASSWORD_LENGTH = 8

interface RegisterFormProps {
  /** Runs after the account is created and the session cookie is set. */
  onSuccess?: () => void
  onSwitchToLogin?: () => void
}

interface FieldErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
}

export function RegisterForm({
  onSuccess,
  onSwitchToLogin,
}: RegisterFormProps) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [errors, setErrors] = useState<FieldErrors>({})

  const register = useRegister()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors: FieldErrors = {}

    if (name.trim().length === 0) {
      nextErrors.name = "Enter your name."
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Enter a valid email address."
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`
    }

    if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords do not match."
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) return

    register.mutate(
      {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      },
      { onSuccess: () => onSuccess?.() }
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <FieldGroup>
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor="register-name">Name</FieldLabel>
          <Input
            id="register-name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={name}
            disabled={register.isPending}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => setName(event.target.value)}
          />
          {errors.name && <FieldError>{errors.name}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="register-email">Email</FieldLabel>
          <Input
            id="register-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            disabled={register.isPending}
            aria-invalid={Boolean(errors.email)}
            onChange={(event) => setEmail(event.target.value)}
          />
          {errors.email && <FieldError>{errors.email}</FieldError>}
        </Field>

        <Field data-invalid={Boolean(errors.password)}>
          <FieldLabel htmlFor="register-password">Password</FieldLabel>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            value={password}
            disabled={register.isPending}
            aria-invalid={Boolean(errors.password)}
            onChange={(event) => setPassword(event.target.value)}
          />
          {errors.password ? (
            <FieldError>{errors.password}</FieldError>
          ) : (
            <FieldDescription>
              At least {MIN_PASSWORD_LENGTH} characters.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.confirmPassword)}>
          <FieldLabel htmlFor="register-confirm-password">
            Confirm password
          </FieldLabel>
          <Input
            id="register-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            disabled={register.isPending}
            aria-invalid={Boolean(errors.confirmPassword)}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {errors.confirmPassword && (
            <FieldError>{errors.confirmPassword}</FieldError>
          )}
        </Field>
      </FieldGroup>

      {register.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            {getApiErrorMessage(register.error)}
          </AlertDescription>
        </Alert>
      )}

      <Button
        type="submit"
        className="w-full"
        disabled={register.isPending}
        aria-busy={register.isPending}
      >
        {register.isPending && <Spinner />}
        Create account
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </button>
      </p>
    </form>
  )
}
