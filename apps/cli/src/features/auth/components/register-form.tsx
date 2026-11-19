import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";

import { TextField } from "../../../components/text-field";
import { SecureField } from "../../../components/secure-field";
import { COLORS } from "../../../theme";
import { useRegister } from "../hooks/use-register";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors `createUserSchema` on the server. */
const MIN_PASSWORD_LENGTH = 8;

type FieldName = "name" | "email" | "password" | "confirmPassword";

interface RegisterFormProps {
  /** Runs after the account is created and the session cookie is set. */
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
  onCancel?: () => void;
  /** One-line fields for short terminals. */
  compact?: boolean;
}

export function RegisterForm({
  onSuccess,
  onSwitchToLogin,
  onCancel,
  compact = false,
}: RegisterFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [focus, setFocus] = useState<FieldName>("name");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});

  const register = useRegister();

  const fields: FieldName[] = ["name", "email", "password", "confirmPassword"];
  const focusIndex = fields.indexOf(focus);

  async function submit() {
    if (register.isPending) return;

    const nextErrors: Partial<Record<FieldName, string>> = {};

    if (name.trim().length === 0) {
      nextErrors.name = "Enter your name.";
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }

    if (confirmPassword !== password) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      const firstInvalid = fields.find((field) => nextErrors[field]);
      if (firstInvalid) setFocus(firstInvalid);
      return;
    }

    const user = await register.mutate({
      name: name.trim(),
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

  const clearError = (field: FieldName) =>
    setErrors((current) => ({ ...current, [field]: undefined }));

  return (
    <box flexDirection="column" width="100%" gap={compact ? 0 : 1}>
      <TextField
        label="Name"
        value={name}
        placeholder="Ada Lovelace"
        focused={focus === "name"}
        error={errors.name}
        compact={compact}
        onFocusRequest={() => setFocus("name")}
        onChange={(value) => {
          setName(value);
          register.reset();
          clearError("name");
        }}
      />

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
          register.reset();
          clearError("email");
        }}
      />

      <SecureField
        label="Password"
        value={password}
        focused={focus === "password"}
        error={errors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        compact={compact}
        onFocusRequest={() => setFocus("password")}
        onChange={(value) => {
          setPassword(value);
          register.reset();
          clearError("password");
        }}
      />

      <SecureField
        label="Confirm password"
        value={confirmPassword}
        focused={focus === "confirmPassword"}
        error={errors.confirmPassword}
        compact={compact}
        onFocusRequest={() => setFocus("confirmPassword")}
        onChange={(value) => {
          setConfirmPassword(value);
          register.reset();
          clearError("confirmPassword");
        }}
      />

      {register.error && (
        <box
          width="100%"
          border={["left"]}
          borderColor={COLORS.error}
          paddingLeft={1}
        >
          <text fg={COLORS.error} wrapMode="word">
            {register.error.message}
          </text>
        </box>
      )}

      <box
        width="100%"
        height={compact ? 1 : 3}
        border={!compact}
        borderStyle="rounded"
        borderColor={register.isPending ? COLORS.faint : COLORS.brand}
        backgroundColor={register.isPending ? COLORS.panel : COLORS.brand}
        alignItems="center"
        justifyContent="center"
        onMouseDown={() => void submit()}
      >
        <text
          fg={register.isPending ? COLORS.muted : COLORS.selectionText}
          attributes={TextAttributes.BOLD}
        >
          {register.isPending ? "◌ Creating account…" : "Create account"}
        </text>
      </box>

      <box flexDirection="row" justifyContent="center" gap={1}>
        <text fg={COLORS.muted}>Already have an account?</text>
        <box onMouseDown={onSwitchToLogin}>
          <text fg={COLORS.accent} attributes={TextAttributes.UNDERLINE}>
            Sign in
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
