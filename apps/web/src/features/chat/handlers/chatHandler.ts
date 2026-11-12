import useAgentChat, {
  type ChatInput,
} from "../hooks/useAgentChat";

function useChatHandler() {
  const chat = useAgentChat();

  const chatHandler = (input: ChatInput) => {
    chat.mutate(input);
  };

  return {
    chatHandler,
    data: chat.data,
    error: chat.error,
    isPending: chat.isPending,
    isError: chat.isError,
    isSuccess: chat.isSuccess,
    reset: chat.reset,
  };
}

export default useChatHandler;