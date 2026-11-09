import { useState } from "react";
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/ui/sidebar";
import { TooltipProvider } from "@workspace/ui/components/ui/tooltip";
import { Header } from "./header";
import { AppSidebar } from "./app-sidebar";
import { ChatBox } from "./chat-box";
import { MessageList } from "./message-list";
import axios, { type AxiosError } from "axios";
import { useCallback, useEffect, useRef } from "react";
import { apiClient } from "@/lib/api-client";

type Effort = "none" | "low" | "medium" | "high";
type AgentMode = "Chat" | "Plan" | "Auto";

type AgentMessageRequest = {
  prompt: string;
  mode?: AgentMode;
  modelId?: string;
  effort?: Effort;
};

type AgentMessageResponse = {
  success: true;
  result: { text: string; usage: unknown };
};

type AgentErrorResponse = {
  success: false;
  error: string;
  details?: unknown;
};

type ChatMessage = { role: "user" | "assistant"; text: string };
type ChatSubmit = {
  prompt: string;
  modelId: string;
  effort: Effort;
  files: File[];
};

async function sendAgentMessage(
  payload: AgentMessageRequest,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const text = payload.prompt.trim();
  if (!text) throw new Error("Prompt must not be empty");
  try {
    const { data } = await apiClient.post<
      AgentMessageResponse | AgentErrorResponse
    >("/agent", { ...payload, prompt: text }, { signal: options?.signal });
    if (!data || typeof data !== "object" || !("success" in data)) {
      throw new Error("Unexpected response from agent server");
    }
    if (data.success === true) return data.result.text;
    throw Object.assign(new Error(data.error || "Agent request failed"), {
      details: data.details,
      status: 400,
    });
  } catch (error) {
    if (axios.isCancel(error) || (error as Error)?.name === "CanceledError") {
      throw new Error("Request was aborted");
    }
    const axiosError = error as AxiosError<AgentErrorResponse>;
    if (axiosError.response?.data?.error) {
      throw Object.assign(new Error(axiosError.response.data.error), {
        details: axiosError.response.data.details,
        status: axiosError.response.status,
        data: axiosError.response.data,
      });
    }
    if (axiosError.response) {
      throw Object.assign(
        new Error(`Agent request failed (${axiosError.response.status})`),
        { status: axiosError.response.status },
      );
    }
    throw new Error("Could not reach agent server");
  }
}

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const handleSubmit = useCallback(async (value: ChatSubmit) => {
    const text = value.prompt.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mountedRef.current) setIsLoading(true);
    setMessages((current) => [...current, { role: "user", text: value.prompt }]);
    try {
      const reply = await sendAgentMessage(
        { prompt: value.prompt, modelId: value.modelId, effort: value.effort },
        { signal: controller.signal },
      );
      setMessages((current) => [...current, { role: "assistant", text: reply }]);
    } catch (error) {
      if (
        (error as Error)?.name === "AbortError" ||
        (error as Error)?.message === "Request was aborted"
      ) {
        return;
      }
      setMessages((current) => [
        ...current,
        { role: "assistant", text: `Error: ${(error as Error).message}` },
      ]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

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
                    streaming={isLoading}
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
