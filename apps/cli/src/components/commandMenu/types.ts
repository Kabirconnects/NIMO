export type CommandContext = {
  exit: () => void;
  newConversation: () => void;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  action?: (ctx: CommandContext) => void | Promise<void>;
};