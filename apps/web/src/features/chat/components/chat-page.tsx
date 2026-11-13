import { useCallback, useEffect, useRef, useState } from "react";
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/ui/sidebar";
import { TooltipProvider } from "@workspace/ui/components/ui/tooltip";
import { Header } from "./header";
import { AppSidebar } from "./app-sidebar";
import { ChatBox } from "./chat-box";
import { MessageList } from "./message-list";
import useChatHandler from "../handlers/chatHandler";
import type { Effort } from "../types";

type ChatSubmit = {
  prompt: string;
  modelId: string;
  effort: Effort;
  files: File[];
};

export function ChatPage() {
  const { messages, sendMessage, stop, reset, isStreaming } = useChatHandler();
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the stream: keep the newest token in view.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  const handleSubmit = useCallback(
    (value: ChatSubmit) => {
      const text = value.prompt.trim();
      if (!text) return;
      void sendMessage({
        prompt: text,
        modelId: value.modelId,
        effort: value.effort,
      });
    },
    [sendMessage],
  );

  function handleNewChat() {
    reset();
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
          <div className="flex h-svh min-h-0 flex-col">
            <Header />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <main className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col px-4">
                <div
                  ref={scrollRef}
                  className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-6 scrollbar-none"
                >
                  <MessageList messages={messages} />
                </div>
                <div className="shrink-0 bg-background pb-4">
                  <ChatBox
                    onSubmit={handleSubmit}
                    streaming={isStreaming}
                    onStop={stop}
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
