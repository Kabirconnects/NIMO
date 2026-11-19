import useAgentChat from "../hooks/useAgentChat";

function useChatHandler() {
  const chat = useAgentChat();

  return {
    messages: chat.messages,
    sendMessage: chat.send,
    stop: chat.stop,
    reset: chat.reset,
    isStreaming: chat.isStreaming,
    error: chat.error,
  };
}

export default useChatHandler;
