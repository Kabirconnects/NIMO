import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";
import type { ChatMessage } from "../types";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) return null;

  return (
    <box flexDirection="column" width="100%" gap={1}>
      {messages.map((message) =>
        message.role === "user" ? (
          <UserMessage key={message.id} text={message.text} />
        ) : (
          <AssistantMessage key={message.id} message={message} />
        ),
      )}
    </box>
  );
}
