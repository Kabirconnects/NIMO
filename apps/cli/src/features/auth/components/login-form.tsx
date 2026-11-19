import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { TextField } from "../../../components/text-field";
import { SecureField } from "../../../components/secure-field";
import { COLORS } from "../../../theme";
import { useLogin } from "../hooks/use-login";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FieldName = "email" | "password";

interface LoginFormProps {
  /** Runs after the session cookie is set. */
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
  onCancel?: () => void;
  /** One-line fields for short terminals. */
  compact?: boolean;
}

export function LoginForm({
  onSuccess,
  onSwitchToRegister,
  onCancel,
  compact = false,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [focus, setFocus] = useState<FieldName>("email");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});

  const login = useLogin();

  const fields: FieldName[] = ["email", "password"];
  const focusIndex = fields.indexOf(focus);

  async function submit() {
    if (login.isPending) return;

    const nextErrors: Partial<Record<FieldName, string>> = {};

    if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (password.length === 0) {
      nextErrors.password = "Enter your password.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setFocus(nextErrors.email ? "email" : "password");
      return;
    }

    const user = await login.mutate({
      email: email.trim().toLowerCase(),
      password,
    });

    if (user) onSuccess?.();
  }

  useKeyboard((key) => {
    if (key.name === "tab") {
      key.preventDefault();
      const delta = key.shift ? -1 : 1;
      const next = (focusIndex + delta + fields.length) % fields.length;
      setFocus(fields[next]!);
      return;
    }

    if (key.name === "return" || key.name === "enter" || key.name === "linefeed") {
      key.preventDefault();
      void submit();
      return;
    }

    if (key.name === "escape") {
      key.preventDefault();
      onCancel?.();
    }
  });

  return (
    <box flexDirection="column" width="100%" gap={compact ? 0 : 1}>
      <TextField
        label="Email"
        value={email}
        placeholder="you@example.com"
        focused={focus === "email"}
        error={errors.email}
        compact={compact}
        onFocusRequest={() => setFocus("email")}
        onChange={(value) => {
          setEmail(value);
          login.reset();
          setErrors((current) => ({ ...current, email: undefined }));
        }}
      />

      <SecureField
        label="Password"
        value={password}
        focused={focus === "password"}
        error={errors.password}
        compact={compact}
        onFocusRequest={() => setFocus("password")}
        onChange={(value) => {
          setPassword(value);
          login.reset();
          setErrors((current) => ({ ...current, password: undefined }));
        }}
      />

      {login.error && (
        <box
          width="100%"
          border={["left"]}
          borderColor={COLORS.error}
          paddingLeft={1}
        >
          <text fg={COLORS.error} wrapMode="word">
            {login.error.message}
          </text>
        </box>
      )}

      <box
        width="100%"
        height={compact ? 1 : 3}
        border={!compact}
        borderStyle="rounded"
        borderColor={login.isPending ? COLORS.faint : COLORS.brand}
        backgroundColor={login.isPending ? COLORS.panel : COLORS.brand}
        alignItems="center"
        justifyContent="center"
        onMouseDown={() => void submit()}
      >
        <text
          fg={login.isPending ? COLORS.muted : COLORS.selectionText}
          attributes={TextAttributes.BOLD}
        >
          {login.isPending ? "◌ Signing in…" : "Sign in"}
        </text>
      </box>

      <box flexDirection="row" justifyContent="center" gap={1}>
        <text fg={COLORS.muted}>Don&apos;t have an account?</text>
        <box onMouseDown={onSwitchToRegister}>
          <text fg={COLORS.accent} attributes={TextAttributes.UNDERLINE}>
            Create one
          </text>
        </box>
      </box>

      {!compact && (
        <box flexDirection="row" justifyContent="center" gap={1}>
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            tab next field · enter submit · esc back
          </text>
        </box>
      )}
    </box>
  );
}
