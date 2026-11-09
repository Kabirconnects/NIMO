import { useState } from "react";
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/ui/sidebar";
import { TooltipProvider } from "@workspace/ui/components/ui/tooltip";
import { Header } from "./components/header";
import { AppSidebar } from "./components/app-sidebar";
import { ChatBox, type ChatSubmit } from "./components/chat-box";

type Message = { role: "user" | "assistant"; text: string };

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();

  function handleSubmit({ prompt, modelId }: ChatSubmit) {
    setMessages((current) => [
      ...current,
      { role: "user", text: prompt },
      { role: "assistant", text: `(${modelId} is not connected yet)` },
    ]);
  }

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
                  {messages.length === 0 ? (
                    <div className="m-auto text-center">
                      <h1 className="text-2xl font-medium text-foreground">
                        What can I help you with?
                      </h1>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Ask anything. Shift+Enter for a new line.
                      </p>
                    </div>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        key={index}
                        className={
                          message.role === "user"
                            ? "ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-sm text-foreground"
                            : "max-w-[80%] text-sm text-foreground"
                        }
                      >
                        {message.text}
                      </div>
                    ))
                  )}
                </div>
                <div className="sticky bottom-0 bg-background pb-4">
                  <ChatBox onSubmit={handleSubmit} />
                </div>
              </main>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
