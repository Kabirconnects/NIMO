import { UserMessage } from "./user-message";
import { AssistantMessage } from "./assistant-message";

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

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
    <>
      {messages.map((message, index) =>
        message.role === "user" ? (
          <UserMessage key={index} text={message.text} />
        ) : (
          <AssistantMessage key={index} text={message.text} />
        ),
      )}
    </>
  );
}
