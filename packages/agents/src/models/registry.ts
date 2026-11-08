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

export const models: Record<string, ModelConfig> = {
  "anthropic/claude-sonnet-4-5": {
    provider: "anthropic",
    name: "Claude Sonnet",
    model: anthropic("claude-sonnet-4-5"),
    capabilities: ["text", "tools", "coding", "reasoning"],
  },
  "google/gemini-2.5-flash": {
    provider: "google",
    name: "Gemini Flash",
    model: google("gemini-2.5-flash"),
    capabilities: ["text", "tools", "multimodal", "reasoning"],
  },
  "google/gemini-3.1-flash-lite": {
    provider: "google",
    name: "Gemini 3.1 Flash-Lite",
    model: google("gemini-3.1-flash-lite"),
    capabilities: ["text", "tools", "multimodal", "reasoning"],
  },
  "google/gemma-4-26b": {
    provider: "google",
    name: "Gemma 4 26B",
    model: google("gemma-4-26b-a4b-it"),
    capabilities: ["text", "tools", "multimodal"],
  },
  "openai/gpt-4.1": {
    provider: "openai",
    name: "GPT-4.1",
    model: openai("gpt-4.1"),
    capabilities: ["text", "tools", "coding"],
  },
  "deepseek/deepseek-chat": {
    provider: "deepseek",
    name: "DeepSeek Chat",
    model: deepseek("deepseek-chat"),
    capabilities: ["text", "coding"],
  },
  "groq/llama-3.3-70b-versatile": {
    provider: "groq",
    name: "Llama 3.3 70B",
    model: groq("llama-3.3-70b-versatile"),
    capabilities: ["text", "tools"],
  },
  "openrouter/auto": {
    provider: "openrouter",
    name: "OpenRouter Auto",
    model: openrouter("openrouter/auto"),
    capabilities: ["text", "tools"],
  },
  "openrouter/free": {
    provider: "openrouter",
    name: "OpenRouter Free (random)",
    model: openrouter("openrouter/free"),
    capabilities: ["text", "tools"],
  },
  "openrouter/qwen3-coder-free": {
    provider: "openrouter",
    name: "Qwen3 Coder (free)",
    model: openrouter("qwen/qwen3-coder:free"),
    capabilities: ["text", "tools", "coding"],
  },
  "openrouter/gemini-2.5-flash": {
    provider: "openrouter",
    name: "Gemini 2.5 Flash (OpenRouter)",
    model: openrouter("google/gemini-2.5-flash"),
    capabilities: ["text", "tools", "multimodal", "reasoning"],
  },
  "ollama/gemma4:e4b": {
    provider: "ollama",
    name: "Gemma 4 E4B (Local)",
    model: ollama("gemma4:e4b"),
    capabilities: ["text", "tools"],
  },
} as const;

export type ModelId = keyof typeof models;

export type ModelProvider =
  | "anthropic"
  | "google"
  | "openai"
  | "deepseek"
  | "groq"
  | "openrouter"
  | "ollama";

export interface ModelConfig {
  provider: ModelProvider;
  name: string;
  model: LanguageModel;
  capabilities: readonly string[];
}

export type ModelCapability = string;

export const MODEL_IDS = Object.keys(models) as [ModelId, ...ModelId[]];

export const ENV_BY_PROVIDER: Record<ModelProvider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  ollama: [], // local, no API key needed
};

export function getModel(id: string): ModelConfig {
  const config = models[id as ModelId];
  if (!config) {
    throw new Error(`Unsupported AI model: ${id}`);
  }
  return config;
}

export function isModelConfigured(id: string): boolean {
  const config = models[id as ModelId];
  return (
    !!config && ENV_BY_PROVIDER[config.provider].every((v) => !!process.env[v])
  );
}

export function supportsTools(id: string): boolean {
  return (getModel(id).capabilities as readonly string[]).includes("tools");
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
      // Gemini 3.x uses thinkingLevel; Gemini 2.5 uses thinkingBudget
      if (id.includes("gemini-3")) {
        return {
          google: {
            thinkingConfig: {
              thinkingLevel: effort === "low" ? "low" : "high",
              includeThoughts: false,
            },
          },
        };
      }
      return {
        google: {
          thinkingConfig: {
            thinkingBudget: GOOGLE_BUDGET[effort],
            includeThoughts: false,
          },
        },
      };

    case "openrouter":
      return { openrouter: { reasoning: { effort } } };

    case "openai":
      // Only for reasoning models (o-series / gpt-5). Add "reasoning" to
      // the capabilities of such a model before this will apply.
      return { openai: { reasoningEffort: effort } };

    case "groq":
      // Only for Groq reasoning models (e.g. gpt-oss, qwen3)
      return { groq: { reasoningEffort: effort } };

    default:
      return undefined;
  }
}