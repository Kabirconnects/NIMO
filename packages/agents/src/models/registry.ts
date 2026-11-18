import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ollama } from "ai-sdk-ollama";
import type { LanguageModel } from "ai";

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const deepseek = createDeepSeek({ apiKey: process.env.DEEPSEEK_API_KEY });
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });

export type ModelProvider =
  | "anthropic"
  | "google"
  | "openai"
  | "deepseek"
  | "groq"
  | "openrouter"
  | "ollama";

/** What a model can do. Drives tool use, reasoning budgets and UI badges. */
export type ModelCapability =
  | "text"
  | "tools"
  | "coding"
  | "reasoning"
  | "multimodal";

/** Rough positioning, used to group and badge models in pickers. */
export type ModelTier = "flagship" | "balanced" | "fast";

export interface ModelConfig {
  provider: ModelProvider;
  name: string;
  model: LanguageModel;
  capabilities: readonly ModelCapability[];
  /** One-line summary shown in model pickers. */
  description: string;
  tier: ModelTier;
  /** An "editor's pick" for its job. */
  recommended?: boolean;
  /** No per-token billing (free OpenRouter tiers, local models). */
  free?: boolean;
  /** Runs on the user's machine via Ollama. */
  local?: boolean;
}

// Only use ids the installed provider SDKs advertise. OpenRouter and Ollama
// accept free-form ids, so the ones below are their public aliases.
//
// The helper keeps the keys as a literal union without leaking provider SDK
// class types into the emitted declarations.
function defineModels<const K extends string>(
  configs: Record<K, ModelConfig>,
): Record<K, ModelConfig> {
  return configs;
}

const modelConfigs = defineModels({
  // -------------------------------------------------------------------------
  // Anthropic
  // -------------------------------------------------------------------------
  "anthropic/claude-opus-5-5": {
    provider: "anthropic",
    name: "Claude Opus 5.5",
    model: anthropic("claude-opus-5-5"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description:
      "Anthropic's flagship — the deepest reasoning for hard coding, analysis and long tasks.",
    tier: "flagship",
  },
  "anthropic/claude-sonnet-5-5": {
    provider: "anthropic",
    name: "Claude Sonnet 5.5",
    model: anthropic("claude-sonnet-5-5"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description:
      "Best all-round Claude: near-Opus quality with much lower latency and cost.",
    tier: "balanced",
    recommended: true,
  },
  "anthropic/claude-haiku-5-5": {
    provider: "anthropic",
    name: "Claude Haiku 5.5",
    model: anthropic("claude-haiku-5-5"),
    capabilities: ["text", "tools", "multimodal"],
    description:
      "Fastest, cheapest Claude — ideal for chat, summaries and high-volume work.",
    tier: "fast",
  },
  "anthropic/claude-sonnet-4-5": {
    provider: "anthropic",
    name: "Claude Sonnet 4.5",
    model: anthropic("claude-sonnet-4-5"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description:
      "Previous-generation Sonnet — a dependable general-purpose model.",
    tier: "balanced",
  },
  "anthropic/claude-haiku-4-5": {
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    model: anthropic("claude-haiku-4-5"),
    capabilities: ["text", "tools", "multimodal"],
    description: "Quick, low-cost Claude 4.5 for simple, high-throughput tasks.",
    tier: "fast",
  },

  // -------------------------------------------------------------------------
  // Google
  // -------------------------------------------------------------------------
  "google/gemini-4-argon": {
    provider: "google",
    name: "Gemini 4 Argon",
    model: google("gemini-4-argon"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description:
      "Google's newest flagship — huge context, strong multimodal reasoning.",
    tier: "flagship",
  },
  "google/gemini-3.8-flash": {
    provider: "google",
    name: "Gemini 3.8 Flash",
    model: google("gemini-3.8-flash"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Newest Flash: near-flagship quality at low latency.",
    tier: "fast",
    recommended: true,
  },
  "google/gemini-3.5-flash": {
    provider: "google",
    name: "Gemini 3.5 Flash",
    model: google("gemini-3.5-flash"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Balanced Flash with excellent price/performance.",
    tier: "fast",
  },
  "google/gemini-3.1-pro-preview": {
    provider: "google",
    name: "Gemini 3.1 Pro (preview)",
    model: google("gemini-3.1-pro-preview"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Pro-tier Gemini for deep reasoning and very long context.",
    tier: "flagship",
  },
  "google/gemini-2.5-flash": {
    provider: "google",
    name: "Gemini 2.5 Flash",
    model: google("gemini-2.5-flash"),
    capabilities: ["text", "tools", "multimodal", "reasoning"],
    description: "Proven workhorse — cheap, fast and multimodal.",
    tier: "fast",
  },
  "google/gemini-3.1-flash-lite": {
    provider: "google",
    name: "Gemini 3.1 Flash-Lite",
    model: google("gemini-3.1-flash-lite"),
    capabilities: ["text", "tools", "multimodal", "reasoning"],
    description: "Lightest Gemini 3.1 — quickest and cheapest.",
    tier: "fast",
  },
  "google/gemma-4-26b": {
    provider: "google",
    name: "Gemma 4 26B",
    model: google("gemma-4-26b-a4b-it"),
    capabilities: ["text", "tools", "multimodal"],
    description: "Open-weights Gemma 4 (26B) served by Google.",
    tier: "balanced",
  },
  "google/gemma-3-27b-it": {
    provider: "google",
    name: "Gemma 3 27B",
    model: google("gemma-3-27b-it"),
    capabilities: ["text", "tools", "multimodal"],
    description: "Open-weights Gemma 3 27B — a solid general-purpose model.",
    tier: "balanced",
  },

  // -------------------------------------------------------------------------
  // OpenAI
  // -------------------------------------------------------------------------
  "openai/gpt-6.1-sol": {
    provider: "openai",
    name: "GPT-6.1 Sol",
    model: openai("gpt-6.1-sol"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "OpenAI's flagship — top-tier reasoning, coding and tool use.",
    tier: "flagship",
  },
  "openai/gpt-6-sol": {
    provider: "openai",
    name: "GPT-6 Sol",
    model: openai("gpt-6-sol"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Previous flagship — still excellent, often cheaper than 6.1.",
    tier: "flagship",
  },
  "openai/gpt-5.6-sol": {
    provider: "openai",
    name: "GPT-5.6 Sol",
    model: openai("gpt-5.6-sol"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Strong reasoning at a lower price than the GPT-6 line.",
    tier: "balanced",
  },
  "openai/gpt-5.5": {
    provider: "openai",
    name: "GPT-5.5",
    model: openai("gpt-5.5"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Reliable general-purpose model with good tool calling.",
    tier: "balanced",
  },
  "openai/gpt-5.4": {
    provider: "openai",
    name: "GPT-5.4",
    model: openai("gpt-5.4"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Balanced quality and cost for everyday coding and chat.",
    tier: "balanced",
  },
  "openai/gpt-5.4-mini": {
    provider: "openai",
    name: "GPT-5.4 mini",
    model: openai("gpt-5.4-mini"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Small GPT-5.4 — fast and inexpensive for everyday tasks.",
    tier: "fast",
    recommended: true,
  },
  "openai/gpt-5.4-nano": {
    provider: "openai",
    name: "GPT-5.4 nano",
    model: openai("gpt-5.4-nano"),
    capabilities: ["text", "tools", "multimodal"],
    description: "Cheapest GPT-5.4 tier for simple, high-volume work.",
    tier: "fast",
  },
  "openai/gpt-4.1": {
    provider: "openai",
    name: "GPT-4.1",
    model: openai("gpt-4.1"),
    capabilities: ["text", "tools", "coding", "multimodal"],
    description: "Dependable non-reasoning model with a large context window.",
    tier: "balanced",
  },
  "openai/o4-mini": {
    provider: "openai",
    name: "o4-mini",
    model: openai("o4-mini"),
    capabilities: ["text", "tools", "coding", "reasoning", "multimodal"],
    description: "Compact reasoning model — strong at math and multi-step logic.",
    tier: "fast",
  },

  // -------------------------------------------------------------------------
  // DeepSeek
  // -------------------------------------------------------------------------
  "deepseek/deepseek-v4-pro": {
    provider: "deepseek",
    name: "DeepSeek V4 Pro",
    model: deepseek("deepseek-v4-pro"),
    capabilities: ["text", "tools", "coding", "reasoning"],
    description:
      "DeepSeek's best reasoning model — strong coding at open-model prices.",
    tier: "flagship",
  },
  "deepseek/deepseek-v4-flash": {
    provider: "deepseek",
    name: "DeepSeek V4 Flash",
    model: deepseek("deepseek-v4-flash"),
    capabilities: ["text", "tools", "coding", "reasoning"],
    description: "Fast DeepSeek V4 with optional thinking — great value.",
    tier: "fast",
    recommended: true,
  },
  "deepseek/deepseek-chat": {
    provider: "deepseek",
    name: "DeepSeek Chat",
    model: deepseek("deepseek-chat"),
    capabilities: ["text", "coding"],
    description: "Previous-generation DeepSeek chat model.",
    tier: "balanced",
  },

  // -------------------------------------------------------------------------
  // Groq (open models, very low latency)
  // -------------------------------------------------------------------------
  "groq/openai/gpt-oss-120b": {
    provider: "groq",
    name: "GPT-OSS 120B",
    model: groq("openai/gpt-oss-120b"),
    capabilities: ["text", "tools", "coding", "reasoning"],
    description: "OpenAI's open-weights 120B on Groq — fast, capable reasoning.",
    tier: "flagship",
  },
  "groq/openai/gpt-oss-20b": {
    provider: "groq",
    name: "GPT-OSS 20B",
    model: groq("openai/gpt-oss-20b"),
    capabilities: ["text", "tools", "coding", "reasoning"],
    description: "Smaller GPT-OSS with Groq's extremely low latency.",
    tier: "fast",
  },
  "groq/moonshotai/kimi-k2-instruct-0905": {
    provider: "groq",
    name: "Kimi K2",
    model: groq("moonshotai/kimi-k2-instruct-0905"),
    capabilities: ["text", "tools", "coding"],
    description: "Agentic coding model with strong tool use.",
    tier: "balanced",
  },
  "groq/qwen/qwen3.6-27b": {
    provider: "groq",
    name: "Qwen 3.6 27B",
    model: groq("qwen/qwen3.6-27b"),
    capabilities: ["text", "tools", "coding"],
    description: "Quick, multilingual general-purpose model.",
    tier: "fast",
  },
  "groq/meta-llama/llama-4-maverick-17b-128e-instruct": {
    provider: "groq",
    name: "Llama 4 Maverick",
    model: groq("meta-llama/llama-4-maverick-17b-128e-instruct"),
    capabilities: ["text", "tools", "multimodal"],
    description: "Open multimodal Llama 4 with fast Groq inference.",
    tier: "balanced",
  },
  "groq/llama-3.3-70b-versatile": {
    provider: "groq",
    name: "Llama 3.3 70B",
    model: groq("llama-3.3-70b-versatile"),
    capabilities: ["text", "tools"],
    description: "The classic fast general model.",
    tier: "fast",
  },
  "groq/deepseek-r1-distill-llama-70b": {
    provider: "groq",
    name: "DeepSeek R1 Distill 70B",
    model: groq("deepseek-r1-distill-llama-70b"),
    capabilities: ["text", "reasoning"],
    description: "Cheap step-by-step reasoning distilled into Llama 70B.",
    tier: "balanced",
  },

  // -------------------------------------------------------------------------
  // OpenRouter (one key, many models)
  // -------------------------------------------------------------------------
  "openrouter/auto": {
    provider: "openrouter",
    name: "OpenRouter Auto",
    model: openrouter("openrouter/auto"),
    capabilities: ["text", "tools"],
    description: "Lets OpenRouter pick the best available model per request.",
    tier: "balanced",
  },
  "openrouter/free": {
    provider: "openrouter",
    name: "OpenRouter Free (random)",
    model: openrouter("openrouter/free"),
    capabilities: ["text", "tools"],
    description: "Random free model — quality varies from request to request.",
    tier: "fast",
    free: true,
  },
  "openrouter/qwen3-coder-free": {
    provider: "openrouter",
    name: "Qwen3 Coder (free)",
    model: openrouter("qwen/qwen3-coder:free"),
    capabilities: ["text", "tools", "coding"],
    description: "Qwen3 Coder on the free tier — strong for coding tasks.",
    tier: "balanced",
    free: true,
  },
  "openrouter/gemini-2.5-flash": {
    provider: "openrouter",
    name: "Gemini 2.5 Flash (OpenRouter)",
    model: openrouter("google/gemini-2.5-flash"),
    capabilities: ["text", "tools", "multimodal", "reasoning"],
    description: "Gemini 2.5 Flash routed through OpenRouter.",
    tier: "fast",
  },

  // -------------------------------------------------------------------------
  // Local (Ollama) — no API key, runs on the user's machine
  // -------------------------------------------------------------------------
  "ollama/gemma4:e4b": {
    provider: "ollama",
    name: "Gemma 4 E4B (Local)",
    model: ollama("gemma4:e4b"),
    capabilities: ["text", "tools"],
    description: "Gemma 4 E4B running locally via Ollama.",
    tier: "fast",
    free: true,
    local: true,
  },
  "ollama/qwen3:8b": {
    provider: "ollama",
    name: "Qwen3 8B (Local)",
    model: ollama("qwen3:8b"),
    capabilities: ["text", "tools", "coding", "reasoning"],
    description: "Qwen3 8B running locally — run `ollama pull qwen3:8b` first.",
    tier: "balanced",
    free: true,
    local: true,
  },
  "ollama/deepseek-r1:8b": {
    provider: "ollama",
    name: "DeepSeek R1 8B (Local)",
    model: ollama("deepseek-r1:8b"),
    capabilities: ["text", "reasoning"],
    description:
      "DeepSeek R1 8B running locally — run `ollama pull deepseek-r1:8b` first.",
    tier: "fast",
    free: true,
    local: true,
  },
});

export type ModelId = keyof typeof modelConfigs;

export const models: Record<ModelId, ModelConfig> = modelConfigs;

/** Every model id, in picker order. */
export const MODEL_IDS = Object.keys(models) as [ModelId, ...ModelId[]];

/** Stable fallback for callers that pass an unknown or missing id. */
export const DEFAULT_MODEL_ID: ModelId = "anthropic/claude-sonnet-4-5";

/** The model a picker should preselect when it is configured. */
export const RECOMMENDED_MODEL_ID: ModelId = "anthropic/claude-sonnet-5-5";

export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  groq: "Groq",
  openrouter: "OpenRouter",
  ollama: "Local (Ollama)",
};

/** Order in which provider groups are rendered. */
export const PROVIDER_ORDER: ModelProvider[] = [
  "anthropic",
  "google",
  "openai",
  "deepseek",
  "groq",
  "openrouter",
  "ollama",
];

export const ENV_BY_PROVIDER: Record<ModelProvider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  ollama: [], // local, no API key needed
};

const hasOwn = (id: string) =>
  Object.prototype.hasOwnProperty.call(models, id);

function lookup(id: string): ModelConfig | undefined {
  return hasOwn(id) ? models[id as ModelId] : undefined;
}

export function isModelId(id: string): id is ModelId {
  return hasOwn(id);
}

export function getModel(id: string): ModelConfig {
  const config = lookup(id);
  if (!config) {
    throw new Error(`Unsupported AI model: ${id}`);
  }
  return config;
}

export function isModelConfigured(id: string): boolean {
  const config = lookup(id);
  return (
    !!config && ENV_BY_PROVIDER[config.provider].every((v) => !!process.env[v])
  );
}

export function supportsTools(id: string): boolean {
  return (getModel(id).capabilities as readonly string[]).includes("tools");
}

/** Validates a user/model-supplied id, otherwise returns the stable fallback. */
export function resolveModelId(id?: string | null): ModelId {
  if (id && isModelId(id)) return id;
  return DEFAULT_MODEL_ID;
}

/**
 * Best first-run choice: the recommended model when its key is configured,
 * otherwise the first recommended configured model, otherwise the first
 * configured one. Local (Ollama) models are never auto-selected — they only
 * work when the user has already pulled them.
 */
export function getDefaultModelId(): ModelId {
  const usable = (id: ModelId) => !models[id].local && isModelConfigured(id);

  if (usable(RECOMMENDED_MODEL_ID)) return RECOMMENDED_MODEL_ID;

  const recommended = MODEL_IDS.find(
    (id) => models[id].recommended && usable(id),
  );

  return recommended ?? MODEL_IDS.find(usable) ?? DEFAULT_MODEL_ID;
}

// ---------------------------------------------------------------------------
// Serializable metadata for model pickers (HTTP responses, CLI prompts, ...)
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: ModelId;
  name: string;
  provider: ModelProvider;
  providerLabel: string;
  description: string;
  capabilities: ModelCapability[];
  tier: ModelTier;
  recommended: boolean;
  free: boolean;
  local: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  /** False when the server is missing this provider's API key. */
  configured: boolean;
}

export interface ModelGroup {
  provider: ModelProvider;
  label: string;
  /** True when at least the provider's key is present. */
  configured: boolean;
  models: ModelOption[];
}

function toModelOption(id: ModelId): ModelOption {
  const config = models[id];
  const capabilities = [...config.capabilities];

  return {
    id,
    name: config.name,
    provider: config.provider,
    providerLabel: PROVIDER_LABELS[config.provider],
    description: config.description,
    capabilities,
    tier: config.tier,
    recommended: config.recommended ?? false,
    free: config.free ?? false,
    local: config.local ?? false,
    supportsTools: capabilities.includes("tools"),
    supportsReasoning: capabilities.includes("reasoning"),
    configured: isModelConfigured(id),
  };
}

/** Flat, JSON-safe list of every model. */
export function getModelOptions(): ModelOption[] {
  return MODEL_IDS.map(toModelOption);
}

/** JSON-safe list grouped by provider, in display order. */
export function getModelGroups(): ModelGroup[] {
  const options = getModelOptions();

  return PROVIDER_ORDER.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    configured: ENV_BY_PROVIDER[provider].every((key) => !!process.env[key]),
    models: options.filter((option) => option.provider === provider),
  })).filter((group) => group.models.length > 0);
}

// ---------------------------------------------------------------------------
// Effort / reasoning level
// ---------------------------------------------------------------------------

export type Effort = "none" | "low" | "medium" | "high";

export const EFFORT_LEVELS: Effort[] = ["none", "low", "medium", "high"];

export function supportsReasoning(id: string): boolean {
  return (getModel(id).capabilities as readonly string[]).includes("reasoning");
}

// Token budgets for providers that use a numeric thinking budget
const ANTHROPIC_BUDGET = { low: 2_000, medium: 8_000, high: 24_000 } as const;
const GOOGLE_BUDGET = { low: 512, medium: 4_096, high: 16_384 } as const;

export function getProviderOptions(
  id: string,
  effort: Effort,
): Record<string, Record<string, any>> | undefined {
  if (effort === "none" || !supportsReasoning(id)) return undefined;

  const { provider } = getModel(id);

  switch (provider) {
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: ANTHROPIC_BUDGET[effort] },
        },
      };

    case "google":
      // Gemini 3.x/4.x uses thinkingLevel; Gemini 2.5 uses thinkingBudget
      if (/gemini-(3|4)/.test(id)) {
        return {
          google: {
            thinkingConfig: {
              thinkingLevel: effort === "low" ? "low" : "high",
              // Stream the model's reasoning so the chat can show its thoughts.
              includeThoughts: true,
            },
          },
        };
      }
      return {
        google: {
          thinkingConfig: {
            thinkingBudget: GOOGLE_BUDGET[effort],
            // Stream the model's reasoning so the chat can show its thoughts.
            includeThoughts: true,
          },
        },
      };

    case "openrouter":
      return { openrouter: { reasoning: { effort } } };

    case "openai":
      // Only for reasoning models (gpt-5/gpt-6/o-series).
      return { openai: { reasoningEffort: effort } };

    case "groq":
      // Only for Groq reasoning models (e.g. gpt-oss, qwen3).
      return { groq: { reasoningEffort: effort } };

    case "deepseek":
      // DeepSeek V4 accepts low | high | max.
      return {
        deepseek: {
          reasoningEffort:
            effort === "high" ? "max" : effort === "medium" ? "high" : "low",
        },
      };

    default:
      return undefined;
  }
}
