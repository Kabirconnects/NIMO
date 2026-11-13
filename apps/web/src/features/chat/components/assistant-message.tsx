import { useState } from "react";
import {
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Wrench,
  X,
} from "lucide-react";
import { Spinner } from "@workspace/ui/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/ui/collapsible";
import { cn } from "@workspace/ui/lib/utils";
import type {
  AssistantChatMessage,
  AssistantPart,
  ToolPart,
  ToolStatus,
} from "../types";

const TOOL_LABELS: Record<string, string> = {
  readFile: "Read file",
  writeFile: "Write file",
  editFile: "Edit file",
  deleteFile: "Delete file",
  deleteDir: "Delete directory",
  listFiles: "List files",
  mkdir: "Create directory",
  search: "Search files",
  glob: "Find files",
  runCommand: "Run command",
  runTests: "Run tests",
  gitStatus: "Git status",
  explainFile: "Explain file",
  refactor: "Refactor",
  benchmark: "Benchmark",
  toolFoundry: "Create tool",
  webFetch: "Fetch page",
  summarize: "Summarize",
  extractData: "Extract data",
};

function humanizeTool(toolName: string) {
  return (
    TOOL_LABELS[toolName] ??
    toolName
      .replace(/[-_]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (char) => char.toUpperCase())
  );
}

/** Pull the most useful "what is this acting on" string out of a tool input. */
function summarizeInput(input: unknown): string | null {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return null;

  const record = input as Record<string, unknown>;
  const keys = [
    "path",
    "filePath",
    "file",
    "command",
    "query",
    "url",
    "pattern",
    "name",
    "prompt",
  ];

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StatusIcon({ status }: { status: ToolStatus }) {
  if (status === "running") {
    return <Spinner className="size-3.5 text-muted-foreground" />;
  }
  if (status === "error") {
    return <CircleAlert className="size-3.5 text-destructive" />;
  }
  return <Check className="size-3.5 text-emerald-500" />;
}

function PayloadBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word text-foreground/90">
        {formatPayload(value)}
      </pre>
    </div>
  );
}

function ToolCard({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const summary = summarizeInput(part.input);
  const hasDetails =
    part.input !== undefined ||
    part.output !== undefined ||
    part.error !== undefined;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="w-full rounded-xl border border-border bg-card/50"
    >
      <CollapsibleTrigger
        disabled={!hasDetails}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors",
          hasDetails && "hover:bg-muted/60",
        )}
      >
        <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium text-foreground">
          {humanizeTool(part.toolName)}
        </span>
        {summary && (
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {summary}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StatusIcon status={part.status} />
          {hasDetails && (
            <ChevronRight
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          )}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="flex flex-col gap-2 border-t border-border/70 px-3 py-2">
          {part.input !== undefined && (
            <PayloadBlock label="Input" value={part.input} />
          )}
          {part.error !== undefined && (
            <PayloadBlock label="Error" value={part.error} />
          )}
          {part.output !== undefined && (
            <PayloadBlock
              label={part.truncated ? "Output (truncated)" : "Output"}
              value={part.output}
            />
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ReasoningBlock({ text, live }: { text: string; live: boolean }) {
  // While the model is thinking the block is open by default; once the user
  // toggles it their choice wins (no effect needed).
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? live;
  const setOpen = setUserOpen;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="w-full min-w-0"
    >
      <CollapsibleTrigger className="group flex w-fit max-w-full items-center gap-2 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Brain className="size-3.5 shrink-0" />
        <span className="truncate">
          {live ? "Thinking…" : "Thought process"}
        </span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 ml-1.75 border-l border-border pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TextBlock({ text, live }: { text: string; live: boolean }) {
  return (
    <div className="leading-relaxed whitespace-pre-wrap text-foreground">
      {text}
      {live && (
        <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground align-text-bottom" />
      )}
    </div>
  );
}

function ErrorBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
      <span className="text-xs">Thinking…</span>
    </div>
  );
}

function renderPart(part: AssistantPart, live: boolean) {
  switch (part.type) {
    case "reasoning":
      return <ReasoningBlock key={part.id} text={part.text} live={live} />;
    case "text":
      return <TextBlock key={part.id} text={part.text} live={live} />;
    case "tool":
      return <ToolCard key={part.id} part={part} />;
    case "error":
      return <ErrorBlock key={part.id} text={part.text} />;
  }
}

function formatModel(modelId: string): string {
  const [, name] = modelId.split("/");
  return (name ?? modelId).replace(/[-_]/g, " ");
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000
    ? `${(tokens / 1_000).toFixed(1)}k tokens`
    : `${tokens} tokens`;
}

function RunMeta({ message }: { message: AssistantChatMessage }) {
  const items: string[] = [];

  if (message.modelId) items.push(formatModel(message.modelId));
  if (message.steps && message.steps > 0) {
    items.push(`${message.steps} ${message.steps === 1 ? "step" : "steps"}`);
  }
  if (message.usage?.totalTokens) {
    items.push(formatTokens(message.usage.totalTokens));
  }
  if (message.durationMs) {
    items.push(`${(message.durationMs / 1000).toFixed(1)}s`);
  }

  if (items.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground/70">
      {items.map((item, index) => (
        <span key={item} className="flex items-center gap-1.5">
          {index > 0 && <span aria-hidden>·</span>}
          {item}
        </span>
      ))}
    </div>
  );
}

export function AssistantMessage({
  message,
}: {
  message: AssistantChatMessage;
}) {
  const { parts, streaming } = message;
  const lastPart = parts[parts.length - 1];

  if (parts.length === 0) {
    return streaming ? (
      <ThinkingDots />
    ) : (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <X className="size-3.5" />
        <span className="text-xs">No response.</span>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-2 text-sm">
      {parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        const live =
          streaming &&
          isLast &&
          (part.type === "text" || part.type === "reasoning");
        return renderPart(part, live);
      })}

      {streaming && lastPart?.type !== "text" && lastPart?.type !== "reasoning" && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          <span>Working…</span>
        </div>
      )}

      {!streaming && <RunMeta message={message} />}
    </div>
  );
}
