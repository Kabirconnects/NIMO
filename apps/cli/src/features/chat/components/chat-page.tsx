import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";

import { Header } from "../../../components/header";
import { HelpOverlay } from "../../../components/help-overlay";
import { MenuOverlay, type MenuRow } from "../../../components/menu-overlay";
import type { CommandContext } from "../../../components/commandMenu/types";
import { COLORS } from "../../../theme";
import { getApiUrl, getConfig, updateConfig } from "../../../lib/config";
import { useLogout, useSession } from "../../auth";
import useChatHandler from "../handlers/chatHandler";
import { useModels } from "../hooks/use-models";
import { EFFORT_LABELS, MODE_LABELS, prettyModelId } from "../labels";
import type { AgentMode, Effort, ModelOption } from "../types";
import { ChatBox } from "./chat-box";
import { MessageList } from "./message-list";
import { UsageOverlay } from "./usage-overlay";
import { WelcomePanel } from "./welcome-panel";

/** Used only until the catalog finishes loading. */
const FALLBACK_MODEL_ID = "anthropic/claude-sonnet-4-5";

type OverlayScreen = "models" | "mode" | "effort" | "help" | "usage" | null;

type Screen = "login" | "register" | "profile";

const MODE_OPTIONS: {
  id: AgentMode;
  description: string;
}[] = [
  {
    id: "Auto",
    description: "Let Nimo decide when to use tools and when to answer directly.",
  },
  {
    id: "Chat",
    description: "Answer directly, without planning or editing files.",
  },
  {
    id: "Plan",
    description: "Think the task through and lay out a plan before acting.",
  },
];

const EFFORT_OPTIONS: { id: Effort; description: string }[] = [
  { id: "none", description: "No extra reasoning. Fastest responses." },
  { id: "low", description: "Light reasoning for quick answers." },
  { id: "medium", description: "Balanced speed and depth (recommended)." },
  { id: "high", description: "Deeper reasoning. Slower but more thorough." },
];

function modelBadges(model: ModelOption): string {
  const badges: string[] = [];

  if (model.recommended) badges.push("recommended");
  if (model.free) badges.push("free");
  if (model.local) badges.push("local");
  if (!model.supportsTools) badges.push("no tools");

  return badges.join(" · ");
}

function modelDescription(model: ModelOption): string {
  const capabilities = model.capabilities.slice(0, 4).join(" · ");
  const base = model.description || capabilities || "No description.";
  const tail = model.configured
    ? capabilities
    : `Unavailable — add ${
        model.provider === "ollama" ? "a local model" : "the provider API key"
      } and restart the API.`;

  return [base, tail].filter(Boolean).join("  ·  ");
}

type ChatPageProps = {
  onNavigate: (screen: Screen) => void;
  onExit: () => void;
};

export function ChatPage({ onNavigate, onExit }: ChatPageProps) {
  const chat = useChatHandler();
  const models = useModels();
  const { user } = useSession();
  const logout = useLogout();

  const [modelId, setModelId] = useState<string | undefined>(
    () => getConfig().modelId,
  );
  const [mode, setMode] = useState<AgentMode>(
    () => getConfig().mode ?? "Auto",
  );
  const [effort, setEffort] = useState<Effort>(
    () => getConfig().effort ?? "medium",
  );

  const [overlay, setOverlay] = useState<OverlayScreen>(null);
  const [overlaySelection, setOverlaySelection] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const groups = models.data?.groups ?? [];
  const resolvedModelId =
    modelId ?? models.data?.defaultModelId ?? FALLBACK_MODEL_ID;

  const modelNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const model of group.models) map.set(model.id, model.name);
    }
    return map;
  }, [groups]);

  const modelLabel =
    modelNames.get(resolvedModelId) ?? prettyModelId(resolvedModelId);

  const notify = useCallback((message: string) => {
    setNotice(message);
  }, []);

  // Notices are transient; the chat keeps the screen otherwise.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  // Follow the stream: keep the newest token in view.
  useEffect(() => {
    const scrollbox = scrollRef.current;
    if (!scrollbox) return;
    scrollbox.scrollTop = scrollbox.scrollHeight;
  }, [chat.messages]);

  const closeOverlay = useCallback(() => setOverlay(null), []);

  const handleNewConversation = useCallback(() => {
    chat.reset();
  }, [chat.reset]);

  const handleSend = useCallback(
    (prompt: string) => {
      const text = prompt.trim();
      if (!text || chat.isStreaming) return;

      void chat.sendMessage({
        prompt: text,
        modelId: resolvedModelId,
        mode,
        effort,
      });
    },
    [chat.isStreaming, chat.sendMessage, effort, mode, resolvedModelId],
  );

  const allModels = useMemo(
    () => groups.flatMap((group) => group.models),
    [groups],
  );

  const openModels = useCallback(() => {
    const preferred =
      allModels.find((model) => model.id === resolvedModelId) ??
      allModels.find((model) => model.configured) ??
      allModels[0];

    setOverlaySelection(models.error ? "__retry" : (preferred?.id ?? null));
    setOverlay("models");
  }, [allModels, models.error, resolvedModelId]);

  const openMode = useCallback(() => {
    setOverlaySelection(mode);
    setOverlay("mode");
  }, [mode]);

  const openEffort = useCallback(() => {
    setOverlaySelection(effort);
    setOverlay("effort");
  }, [effort]);

  const commandContext: CommandContext = {
    user,
    streaming: chat.isStreaming,
    exit: onExit,
    newConversation: handleNewConversation,
    navigate: onNavigate,
    logout: async () => {
      await logout.mutate();
      notify("Signed out of this terminal.");
    },
    openModels,
    openMode,
    openEffort,
    showHelp: () => setOverlay("help"),
    showUsage: () => setOverlay("usage"),
    stop: chat.stop,
    notify,
  };

  const modelRows = useMemo<MenuRow[]>(() => {
    const rows: MenuRow[] = [];

    if (models.error) {
      rows.push({
        type: "group",
        id: "group-error",
        label: "Catalog",
      });
      rows.push({
        type: "item",
        id: "__retry",
        label: "Retry loading models",
        hint: "retry",
        description: models.error.message,
      });
    } else if (groups.length === 0) {
      // Never draw an empty box: a pending or empty catalog gets an explicit
      // row, so the picker always explains itself.
      rows.push({
        type: "item",
        id: "__status",
        label: models.isPending
          ? "Loading the model catalog…"
          : "No models available",
        hint: models.isPending ? "loading" : "empty",
        description: models.isPending
          ? `Waiting for ${getApiUrl()}/agent/models`
          : "The API reported no models. Use /models to retry after checking the server.",
        disabled: true,
      });
    }

    for (const group of groups) {
      if (group.models.length === 0) continue;

      rows.push({
        type: "group",
        id: `group-${group.provider}`,
        label: group.configured ? group.label : `${group.label} · not configured`,
      });

      for (const model of group.models) {
        rows.push({
          type: "item",
          id: model.id,
          label: model.name,
          hint: modelBadges(model),
          description: modelDescription(model),
          disabled: !model.configured,
        });
      }
    }

    return rows;
  }, [groups, models.error, models.isPending]);

  const handleModelSelect = useCallback(
    (id: string) => {
      if (id === "__retry") {
        models.reload();
        notify("Reloading the model catalog…");
        return;
      }

      const model = allModels.find((entry) => entry.id === id);
      if (!model || !model.configured) return;

      setModelId(model.id);
      updateConfig({ modelId: model.id });
      setOverlay(null);
      notify(`Model set to ${model.name}.`);
    },
    [allModels, models.reload, notify],
  );

  const handleModeSelect = useCallback(
    (id: string) => {
      const next = MODE_OPTIONS.find((option) => option.id === id)?.id;
      if (!next) return;

      setMode(next);
      updateConfig({ mode: next });
      setOverlay(null);
      notify(`Mode set to ${MODE_LABELS[next]}.`);
    },
    [notify],
  );

  const handleEffortSelect = useCallback(
    (id: string) => {
      const next = EFFORT_OPTIONS.find((option) => option.id === id)?.id;
      if (!next) return;

      setEffort(next);
      updateConfig({ effort: next });
      setOverlay(null);
      notify(`Reasoning effort set to ${EFFORT_LABELS[next]}.`);
    },
    [notify],
  );

  const modelsSubtitle = models.error
    ? "The catalog could not be loaded."
    : models.isPending
      ? "Loading the model catalog…"
      : groups.length === 0
        ? "The API returned no models."
        : `${groups.reduce((count, group) => count + group.models.length, 0)} models across ${
            groups.length
          } ${groups.length === 1 ? "provider" : "providers"}.`;

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={COLORS.background}
    >
      <Header
        onProfile={() => onNavigate("profile")}
        onSignIn={() => onNavigate("login")}
      />

      <box flexGrow={1} minHeight={0} paddingX={2} paddingTop={1}>
        {chat.messages.length === 0 ? (
          <WelcomePanel
            modelLabel={modelLabel}
            mode={MODE_LABELS[mode]}
            effort={EFFORT_LABELS[effort]}
          />
        ) : (
          <scrollbox
            ref={scrollRef}
            flexGrow={1}
            stickyScroll
            stickyStart="bottom"
          >
            <MessageList messages={chat.messages} />
          </scrollbox>
        )}
      </box>

      <box paddingX={2} paddingBottom={1} flexShrink={0}>
        <ChatBox
          streaming={chat.isStreaming}
          overlayOpen={overlay !== null}
          notice={notice}
          modelLabel={modelLabel}
          mode={mode}
          effort={effort}
          commandContext={commandContext}
          onSubmit={handleSend}
          onStop={chat.stop}
        />
      </box>

      {overlay === "models" && (
        <MenuOverlay
          title="Models"
          subtitle={modelsSubtitle}
          rows={modelRows}
          selectedId={overlaySelection}
          onSelect={setOverlaySelection}
          onExecute={handleModelSelect}
          onClose={closeOverlay}
        />
      )}

      {overlay === "mode" && (
        <MenuOverlay
          title="Mode"
          subtitle="Choose how Nimo should approach your request."
          rows={MODE_OPTIONS.map((option) => ({
            type: "item" as const,
            id: option.id,
            label: MODE_LABELS[option.id],
            hint: option.id === mode ? "current" : undefined,
            description: option.description,
          }))}
          selectedId={overlaySelection}
          onSelect={setOverlaySelection}
          onExecute={handleModeSelect}
          onClose={closeOverlay}
        />
      )}

      {overlay === "effort" && (
        <MenuOverlay
          title="Reasoning effort"
          subtitle="Higher effort takes longer but thinks more carefully."
          rows={EFFORT_OPTIONS.map((option) => ({
            type: "item" as const,
            id: option.id,
            label: EFFORT_LABELS[option.id],
            hint: option.id === effort ? "current" : undefined,
            description: option.description,
          }))}
          selectedId={overlaySelection}
          onSelect={setOverlaySelection}
          onExecute={handleEffortSelect}
          onClose={closeOverlay}
        />
      )}

      {overlay === "help" && <HelpOverlay onClose={closeOverlay} />}

      {overlay === "usage" && (
        <UsageOverlay messages={chat.messages} onClose={closeOverlay} />
      )}
    </box>
  );
}
