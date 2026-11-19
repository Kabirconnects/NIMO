import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/react";

import { COLORS } from "../../../theme";
import { getApiUrl } from "../../../lib/config";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

export type AuthMode = "login" | "register";

interface AuthPageProps {
  mode: AuthMode;
  onSuccess: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  onCancel: () => void;
}

/** Terminal counterpart of the web auth page. */
export function AuthPage({
  mode,
  onSuccess,
  onSwitchMode,
  onCancel,
}: AuthPageProps) {
  const dimensions = useTerminalDimensions();
  const isLogin = mode === "login";

  // On a 24-30 row terminal the framed fields would not fit, so switch to a
  // one-line-per-field layout. The forms themselves are identical.
  const compact = dimensions.height < 40;
  const cardWidth = Math.max(30, Math.min(60, dimensions.width - 4));

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor={COLORS.background}
    >
      <box
        width={cardWidth}
        border
        borderStyle="rounded"
        borderColor={COLORS.border}
        backgroundColor={COLORS.background}
        title=" Nimo "
        titleColor={COLORS.brand}
        titleAlignment="left"
        paddingX={2}
        paddingY={compact ? 0 : 1}
        flexDirection="column"
        gap={compact ? 0 : 1}
      >
        {compact ? (
          <box flexDirection="row" gap={1} height={1}>
            <text fg={COLORS.brand} attributes={TextAttributes.BOLD}>
              ◆ Nimo
            </text>
            <text fg={COLORS.dim}>
              {isLogin ? "· Welcome back" : "· Create an account"}
            </text>
          </box>
        ) : (
          <box flexDirection="column" alignItems="center" gap={0}>
            <ascii-font
              font="tiny"
              text="NIMO"
              color={[COLORS.brand, COLORS.accent]}
            />
            <text fg={COLORS.dim}>
              {isLogin ? "Welcome back" : "Create an account"}
            </text>
            <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
              {isLogin
                ? "Sign in to continue to Nimo."
                : "Start chatting with Nimo in a few seconds."}
            </text>
          </box>
        )}

        <box
          width="100%"
          height={1}
          border={["bottom"]}
          borderColor={COLORS.faint}
        />

        {isLogin ? (
          <LoginForm
            compact={compact}
            onSuccess={onSuccess}
            onCancel={onCancel}
            onSwitchToRegister={() => onSwitchMode("register")}
          />
        ) : (
          <RegisterForm
            compact={compact}
            onSuccess={onSuccess}
            onCancel={onCancel}
            onSwitchToLogin={() => onSwitchMode("login")}
          />
        )}
      </box>

      <box paddingTop={compact ? 0 : 1} height={1}>
        <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
          {getApiUrl()}
        </text>
      </box>
    </box>
  );
}
