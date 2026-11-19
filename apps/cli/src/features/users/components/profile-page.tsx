import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { Header } from "../../../components/header";
import { COLORS } from "../../../theme";
import { initials } from "../../../lib/initials";
import { useLogout, useSession } from "../../auth";

type ProfilePageProps = {
  onBack: () => void;
  onSignIn: () => void;
};

/** Read-only account page (the server's `updateUser` is still a TODO). */
export function ProfilePage({ onBack, onSignIn }: ProfilePageProps) {
  const { user, isPending } = useSession();
  const logout = useLogout();
  const dimensions = useTerminalDimensions();
  const cardWidth = Math.max(32, Math.min(56, dimensions.width - 4));

  async function signOut() {
    await logout.mutate();
    onBack();
  }

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      onBack();
      return;
    }

    if (!user && (key.name === "return" || key.name === "i")) {
      key.preventDefault();
      onSignIn();
      return;
    }

    if (key.name === "s" && !key.ctrl && !key.meta && user && !logout.isPending) {
      key.preventDefault();
      void signOut();
    }
  });

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={COLORS.background}
    >
      <Header />

      <box flexGrow={1} alignItems="center" justifyContent="center">
        {isPending ? (
          <text fg={COLORS.muted}>Checking your session…</text>
        ) : !user ? (
          <box
            width={48}
            border
            borderStyle="rounded"
            borderColor={COLORS.border}
            paddingX={2}
            paddingY={1}
            flexDirection="column"
            alignItems="center"
            gap={1}
          >
            <text fg={COLORS.text}>You are not signed in.</text>
            <text fg={COLORS.dim} attributes={TextAttributes.DIM}>
              Sign in to see your account details.
            </text>
            <box
              width="100%"
              height={1}
              border={["bottom"]}
              borderColor={COLORS.faint}
            />
            <box flexDirection="row" gap={2}>
              <box onMouseDown={onBack}>
                <text fg={COLORS.muted}>[esc] back</text>
              </box>
              <box onMouseDown={onSignIn}>
                <text fg={COLORS.accent} attributes={TextAttributes.UNDERLINE}>
                  Sign in
                </text>
              </box>
            </box>
          </box>
        ) : (
          <box
            width={cardWidth}
            border
            borderStyle="rounded"
            borderColor={COLORS.border}
            backgroundColor={COLORS.background}
            title=" Profile "
            titleColor={COLORS.brand}
            titleAlignment="left"
            paddingX={2}
            paddingY={1}
            flexDirection="column"
            gap={1}
          >
            <box flexDirection="row" alignItems="center" gap={2}>
              <box
                width={7}
                height={3}
                border
                borderStyle="rounded"
                borderColor={COLORS.border}
                backgroundColor={COLORS.panel}
                alignItems="center"
                justifyContent="center"
              >
                <text fg={COLORS.accent} attributes={TextAttributes.BOLD}>
                  {initials(user.name)}
                </text>
              </box>

              <box flexDirection="column" flexGrow={1} overflow="hidden">
                <box flexDirection="row" gap={1}>
                  <text fg={COLORS.text} attributes={TextAttributes.BOLD} truncate>
                    {user.name}
                  </text>
                  {user.role === "admin" && (
                    <text fg={COLORS.warning} attributes={TextAttributes.DIM}>
                      admin
                    </text>
                  )}
                </box>
                <text fg={COLORS.dim} truncate>
                  {user.email}
                </text>
              </box>
            </box>

            <box
              width="100%"
              height={1}
              border={["bottom"]}
              borderColor={COLORS.faint}
            />

            <box flexDirection="row" gap={1}>
              <box width={10}>
                <text fg={COLORS.muted}>Email</text>
              </box>
              <text fg={COLORS.text} truncate>
                {user.email}
              </text>
            </box>

            <box flexDirection="row" gap={1}>
              <box width={10}>
                <text fg={COLORS.muted}>Role</text>
              </box>
              <text fg={user.role === "admin" ? COLORS.warning : COLORS.text}>
                {user.role === "admin" ? "Admin" : "Member"}
              </text>
            </box>

            <box flexDirection="row" gap={1}>
              <box width={10}>
                <text fg={COLORS.muted}>Status</text>
              </box>
              <text fg={user.isActive ? COLORS.success : COLORS.error}>
                {user.isActive ? "Active" : "Disabled"}
              </text>
            </box>

            <box
              width="100%"
              height={1}
              border={["bottom"]}
              borderColor={COLORS.faint}
            />

            <box flexDirection="row" gap={2}>
              <box
                height={3}
                flexGrow={1}
                border
                borderStyle="rounded"
                borderColor={COLORS.faint}
                alignItems="center"
                justifyContent="center"
                onMouseDown={onBack}
              >
                <text fg={COLORS.text}>Back to chat</text>
              </box>

              <box
                height={3}
                flexGrow={1}
                border
                borderStyle="rounded"
                borderColor={logout.isPending ? COLORS.faint : COLORS.error}
                alignItems="center"
                justifyContent="center"
                onMouseDown={() => {
                  if (!logout.isPending) void signOut();
                }}
              >
                <text fg={logout.isPending ? COLORS.muted : COLORS.error}>
                  {logout.isPending ? "Signing out…" : "Sign out"}
                </text>
              </box>
            </box>

            <box justifyContent="center" flexDirection="row">
              <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
                esc back · s sign out · editing coming soon
              </text>
            </box>
          </box>
        )}
      </box>
    </box>
  );
}
