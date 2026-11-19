import { useCallback, useEffect, useState } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";

import { ChatPage } from "../features/chat";
import { AuthPage, refreshSession } from "../features/auth";
import { ProfilePage } from "../features/users";
import { COLORS } from "../theme";

type Screen = "chat" | "login" | "register" | "profile";

/**
 * Top-level screen router.
 *
 * Unlike the web app there are no URLs in a terminal, so the active screen is
 * just local state. Every screen is reachable from the chat command menu.
 */
export function App() {
  const renderer = useRenderer();
  const [screen, setScreen] = useState<Screen>("chat");

  useEffect(() => {
    void refreshSession();
  }, []);

  const exit = useCallback(() => {
    renderer.destroy();

    // The renderer asks callers to wait for `closed` so the terminal is
    // restored, but never leave the user stuck if that promise stalls.
    const fallback = setTimeout(() => process.exit(0), 1500);

    void renderer.closed
      .then(() => {
        clearTimeout(fallback);
        process.exit(0);
      })
      .catch(() => {
        clearTimeout(fallback);
        process.exit(0);
      });
  }, [renderer]);

  // Ctrl+C works from every screen, including while a field has focus.
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      exit();
    }
  });

  // Logging out from the profile page returns to chat (the page itself handles
  // an expired session by offering to sign in again).
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={COLORS.background}
    >
      {screen === "chat" && (
        <ChatPage onNavigate={setScreen} onExit={exit} />
      )}

      {screen === "login" && (
        <AuthPage
          mode="login"
          onSuccess={() => setScreen("chat")}
          onSwitchMode={(mode) => setScreen(mode)}
          onCancel={() => setScreen("chat")}
        />
      )}

      {screen === "register" && (
        <AuthPage
          mode="register"
          onSuccess={() => setScreen("chat")}
          onSwitchMode={(mode) => setScreen(mode)}
          onCancel={() => setScreen("chat")}
        />
      )}

      {screen === "profile" && (
        <ProfilePage
          onBack={() => setScreen("chat")}
          onSignIn={() => setScreen("login")}
        />
      )}
    </box>
  );
}

export default App;
