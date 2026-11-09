import { useRef, useState } from "react";
import {
  ArrowUp,
  Paperclip,
  Square,
  X,
  Zap,
  Brain,
  Flame,
} from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/ui/select";
import { cn } from "@workspace/ui/lib/utils";

type Effort = "none" | "low" | "medium" | "high";
type EffortOption = "low" | "medium" | "high";
type Model = { id: string; name: string };

export type ChatSubmit = {
  prompt: string;
  modelId: string;
  effort: Effort;
  files: File[];
};

const MODEL_GROUPS: { label: string; models: Model[] }[] = [
  {
    label: "Anthropic",
    models: [{ id: "anthropic/claude-sonnet-4-5", name: "Claude Sonnet" }],
  },
  {
    label: "Google",
    models: [
      { id: "google/gemini-2.5-flash", name: "Gemini Flash" },
      { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite" },
      { id: "google/gemma-4-26b", name: "Gemma 4 26B" },
    ],
  },
  {
    label: "OpenAI",
    models: [{ id: "openai/gpt-4.1", name: "GPT-4.1" }],
  },
  {
    label: "DeepSeek",
    models: [{ id: "deepseek/deepseek-chat", name: "DeepSeek Chat" }],
  },
  {
    label: "Groq",
    models: [{ id: "groq/llama-3.3-70b-versatile", name: "Llama 3.3 70B" }],
  },
  {
    label: "OpenRouter",
    models: [
      { id: "openrouter/auto", name: "OpenRouter Auto" },
      { id: "openrouter/free", name: "OpenRouter Free" },
      { id: "openrouter/qwen3-coder-free", name: "Qwen3 Coder (free)" },
      { id: "openrouter/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
  },
  {
    label: "Local",
    models: [{ id: "ollama/gemma4:e4b", name: "Gemma 4 E4B" }],
  },
];

const EFFORTS: { value: EffortOption; label: string; icon: typeof Zap }[] = [
  { value: "low", label: "Fast", icon: Zap },
  { value: "medium", label: "Balanced", icon: Brain },
  { value: "high", label: "Deep", icon: Flame },
];

export function ChatBox({
  className,
  onSubmit,
  streaming = false,
  onStop,
}: {
  className?: string;
  onSubmit?: (value: ChatSubmit) => void;
  streaming?: boolean;
  onStop?: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [modelId, setModelId] = useState(MODEL_GROUPS[0].models[0].id);
  const [effort, setEffort] = useState<Effort>("medium");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const canSend = prompt.trim().length > 0 && !streaming;

  function submit() {
    if (!canSend) return;
    onSubmit?.({ prompt: prompt.trim(), modelId, effort, files });
    setPrompt("");
    setFiles([]);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className={cn(
        "rounded-2xl border border-border bg-card shadow-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30",
        className,
      )}
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {files.map((file) => (
            <span
              key={`${file.name}-${file.size}`}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              <Paperclip className="size-3" />
              <span className="max-w-40 truncate">{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setFiles((current) => current.filter((item) => item !== file))
                }
                className="rounded hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Message Nimo…"
        rows={1}
        className="max-h-48 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0 dark:bg-transparent"
      />

      <div className="flex items-center justify-between gap-2 px-2 pb-2">
        <div className="flex min-w-0 items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              setFiles((current) => [...current, ...picked]);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Attach files"
            onClick={() => fileInput.current?.click()}
            className="text-muted-foreground"
          >
            <Paperclip />
          </Button>

          <Select value={modelId} onValueChange={(value) => value && setModelId(value)}>
            <SelectTrigger
              size="sm"
              className="max-w-44 border-0 bg-transparent shadow-none hover:bg-muted dark:bg-transparent"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" className="max-h-72">
              {MODEL_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.models.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center rounded-lg bg-muted p-0.5">
            {EFFORTS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setEffort(value)}
                title={label}
                aria-pressed={effort === value}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
                  effort === value && "bg-background text-foreground shadow-xs",
                )}
              >
                <Icon className="size-3" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {streaming ? (
          <Button
            type="button"
            size="icon-sm"
            aria-label="Stop generating"
            onClick={onStop}
            className="rounded-full"
          >
            <Square className="size-3" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            disabled={!canSend}
            aria-label="Send message"
            className="rounded-full"
          >
            <ArrowUp />
          </Button>
        )}
      </div>
    </form>
  );
}
