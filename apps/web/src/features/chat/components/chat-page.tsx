import { useState, useEffect } from "react";
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/ui/sidebar";
import { TooltipProvider } from "@workspace/ui/components/ui/tooltip";
import { Header } from "./header";
import { AppSidebar } from "./app-sidebar";
import { ChatBox } from "./chat-box";
import { MessageList } from "./message-list";
import useChatHandler from "../handlers/chatHandler";
import { useCallback } from "react";

type Effort = "none" | "low" | "medium" | "high";

type ChatMessage = { role: "user" | "assistant"; text: string };
type ChatSubmit = {
  prompt: string;
  modelId: string;
  effort: Effort;
  files: File[];
};

export function ChatPage() {
  const { chatHandler, data, error, isPending, reset } = useChatHandler();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();

  useEffect(() => {
    if (data?.result?.text) {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: data.result.text },
      ]);
      reset();
    }
  }, [data, reset]);

  useEffect(() => {
    if (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: `Error: ${message}` },
      ]);
      reset();
    }
  }, [error, reset]);

  const handleSubmit = useCallback((value: ChatSubmit) => {
    const text = value.prompt.trim();
    if (!text) return;
    setMessages((current) => [...current, { role: "user", text: value.prompt }]);
    chatHandler({
      prompt: value.prompt,
      modelId: value.modelId,
      effort: value.effort,
    });
  }, [chatHandler]);

  function handleNewChat() {
    setMessages([]);
    setActiveChatId(undefined);
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          activeChatId={activeChatId}
          onSelect={setActiveChatId}
          onNewChat={handleNewChat}
        />
        <SidebarInset>
          <div className="flex min-h-svh flex-col">
            <Header />
            <div className="flex min-h-0 flex-1 flex-col">
              <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
                <div className="flex flex-1 flex-col gap-4 py-6">
                  <MessageList messages={messages} />
                </div>
                <div className="sticky bottom-0 bg-background pb-4">
                  <ChatBox
                    onSubmit={handleSubmit}
                    streaming={isPending}
                  />
                </div>
              </main>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
