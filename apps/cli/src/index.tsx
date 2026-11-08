import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import Header from "./components/header";
import InfoPanel from "./components/info-panel";
import InputBar from "./components/InputBar";
import { ChatArea } from "./components/chatArea";

function App() {
  const handleSend = (): void => {};

  return (
    <box
      flexDirection="column"
      alignItems="center"
      width="100%"
      height="100%"
      paddingTop={1}
    >
      {/* Header aligned to the left */}
      <Header />

      <InfoPanel />

      <box flexGrow={1} />

      <ChatArea />

      <InputBar
        onSubmit={handleSend}
        commandContext={{
          newConversation: () => {},
          exit: () => process.exit(0),
        }}
      />
      <text fg="#999999">enter to send · /help · ctrl+c to exit</text>
    </box>
  );
} 

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});


// async function renderer(params:type) {
  
// }

createRoot(renderer).render(<App />);
