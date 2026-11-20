import type { User } from "../../features/auth";

export type CommandContext = {
  /** Current session user, or null for a guest. */
  user: User | null;
  /** True while a response is streaming. */
  streaming: boolean;
  /** Close the app. */
  exit: () => void;
  /** Clear the current conversation. */
  newConversation: () => void;
  navigate: (screen: "login" | "register" | "profile") => void;
  logout: () => void | Promise<void>;
  openModels: () => void;
  openMode: () => void;
  openEffort: () => void;
  showHelp: () => void;
  /** Show token usage for the current conversation. */
  showUsage: () => void;
  /** Start the Nimo API if it is not already running. */
  startBackend: () => void | Promise<void>;
  /** Start the API and the web dashboard, then open it. */
  startDashboard: () => void | Promise<void>;
  stop: () => void;
  notify: (message: string) => void;
};

export type Command = {
  name: string;
  description: string;
  value: string;
  action?: (ctx: CommandContext) => void | Promise<void>;
};
