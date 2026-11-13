import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";
import type { ChatMessage } from "../types";

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="m-auto text-center">
        <h1 className="text-2xl font-medium text-foreground">
          What can I help you with?
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask anything. Shift+Enter for a new line.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {messages.map((message) =>
        message.role === "user" ? (
          <UserMessage key={message.id} text={message.text} />
        ) : (
          <AssistantMessage key={message.id} message={message} />
        ),
      )}
    </div>
  );
}
