import { TextAttributes } from "@opentui/core";

import { COLORS } from "../theme";
import { useSession } from "../features/auth";
import { initials } from "../lib/initials";

type HeaderProps = {
  onProfile?: () => void;
  onSignIn?: () => void;
};

/** One-line app header: brand on the left, session on the right. */
export function Header({ onProfile, onSignIn }: HeaderProps) {
  const { user, isPending } = useSession();

  return (
    <box width="100%" flexDirection="column" flexShrink={0}>
      <box
        width="100%"
        height={1}
        flexDirection="row"
        alignItems="center"
        paddingX={2}
      >
        <text fg={COLORS.brand} attributes={TextAttributes.BOLD}>
          ◆ Nimo
        </text>
        <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
          {" "}
          · AI agent in your terminal
        </text>

        <box flexGrow={1} />

        {isPending ? (
          <text fg={COLORS.faint} attributes={TextAttributes.DIM}>
            checking session…
          </text>
        ) : user ? (
          <box
            flexDirection="row"
            alignItems="center"
            gap={1}
            onMouseDown={onProfile}
          >
            <text fg={COLORS.brand}>●</text>
            <text fg={COLORS.accent}>{initials(user.name)}</text>
            <text fg={COLORS.dim} truncate>
              {user.name}
            </text>
            {user.role === "admin" && (
              <text fg={COLORS.warning} attributes={TextAttributes.DIM}>
                admin
              </text>
            )}
          </box>
        ) : (
          <box flexDirection="row" alignItems="center" gap={1}>
            <text fg={COLORS.faint}>guest</text>
            <box onMouseDown={onSignIn}>
              <text fg={COLORS.accent} attributes={TextAttributes.UNDERLINE}>
                sign in
              </text>
            </box>
          </box>
        )}
      </box>

      <box
        width="100%"
        height={1}
        border={["bottom"]}
        borderColor={COLORS.faint}
      />
    </box>
  );
}

export default Header;
