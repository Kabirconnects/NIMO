import type { Command } from "./types";

export const COMMANDS: Command[] = [
  {
    name: "new",
    description: "Start a new conversation",
    value: "/new",
    action: (ctx) => {
      ctx.newConversation();
      ctx.notify("Started a new conversation.");
    },
  },
  {
    name: "models",
    description: "Choose the model that answers you",
    value: "/models",
    action: (ctx) => {
      ctx.openModels();
    },
  },
  {
    name: "mode",
    description: "Switch agent mode (Chat, Plan, Auto)",
    value: "/mode",
    action: (ctx) => {
      ctx.openMode();
    },
  },
  {
    name: "effort",
    description: "Set reasoning effort",
    value: "/effort",
    action: (ctx) => {
      ctx.openEffort();
    },
  },
  {
    name: "stop",
    description: "Stop the response being generated",
    value: "/stop",
    action: (ctx) => {
      if (!ctx.streaming) {
        ctx.notify("Nothing is running right now.");
        return;
      }
      ctx.stop();
      ctx.notify("Stopped the response.");
    },
  },
  {
    name: "login",
    description: "Sign in to your account",
    value: "/login",
    action: (ctx) => {
      if (ctx.user) {
        ctx.notify(`Already signed in as ${ctx.user.name}.`);
        return;
      }
      ctx.navigate("login");
    },
  },
  {
    name: "register",
    description: "Create a Nimo account",
    value: "/register",
    action: (ctx) => {
      if (ctx.user) {
        ctx.notify(`Already signed in as ${ctx.user.name}.`);
        return;
      }
      ctx.navigate("register");
    },
  },
  {
    name: "profile",
    description: "Show your account details",
    value: "/profile",
    action: (ctx) => {
      if (!ctx.user) {
        ctx.notify("Sign in to see your profile.");
        ctx.navigate("login");
        return;
      }
      ctx.navigate("profile");
    },
  },
  {
    name: "logout",
    description: "Sign out of this terminal",
    value: "/logout",
    action: (ctx) => {
      if (!ctx.user) {
        ctx.notify("You are not signed in.");
        return;
      }
      void ctx.logout();
    },
  },
  {
    name: "help",
    description: "Show commands and keyboard shortcuts",
    value: "/help",
    action: (ctx) => {
      ctx.showHelp();
    },
  },
  {
    name: "usage",
    description: "Show token usage for this conversation",
    value: "/usage",
    action: (ctx) => {
      ctx.showUsage();
    },
  },
  {
    name: "exit",
    description: "Quit the application",
    value: "/exit",
    action: (ctx) => {
      ctx.exit();
    },
  },
];
