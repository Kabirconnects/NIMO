import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";

export interface ChatInput {
  prompt: string;
  modelId?: string;
  mode?: "Chat" | "Plan" | "Auto";
  effort?: "none" | "low" | "medium" | "high";
  confirmDestructive?: boolean;
}

export interface ChatResponse {
  success: boolean;
  result: {
    text: string;
    usage: unknown;
  };
}

function useAgentChat() {
  return useMutation({
    mutationFn: async (input: ChatInput) => {
      try {
        const { data } = await apiClient.post<ChatResponse>(
          "/agent",
          input,
        );
        return data;
      } catch (err: unknown) {
        if (
          typeof err === "object" &&
          err !== null &&
          "response" in err &&
          typeof (err as { response?: { data?: unknown } }).response?.data === "object"
        ) {
          const errorData = (err as { response: { data: unknown } }).response.data;
          const msg =
            typeof errorData === "object" && errorData !== null && "error" in errorData
              ? String((errorData as { error: unknown }).error)
              : "Request failed";
          throw new Error(msg);
        }
        throw err;
      }
    },
  });
}

export default useAgentChat;