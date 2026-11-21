/** AI providers the agent can talk to, keyed by the env var the server reads. */
export type Provider = {
  env: string;
  label: string;
  /** Model id prefix used to spot the provider a model belongs to. */
  prefix: string;
  help: string;
};

export const PROVIDERS: readonly Provider[] = [
  {
    env: "ANTHROPIC_API_KEY",
    label: "Anthropic",
    prefix: "anthropic/",
    help: "https://console.anthropic.com/settings/keys",
  },
  {
    env: "GOOGLE_GENERATIVE_AI_API_KEY",
    label: "Google",
    prefix: "google/",
    help: "https://aistudio.google.com/apikey",
  },
  {
    env: "OPENAI_API_KEY",
    label: "OpenAI",
    prefix: "openai/",
    help: "https://platform.openai.com/api-keys",
  },
  {
    env: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
    prefix: "deepseek/",
    help: "https://platform.deepseek.com/api_keys",
  },
  {
    env: "GROQ_API_KEY",
    label: "Groq",
    prefix: "groq/",
    help: "https://console.groq.com/keys",
  },
  {
    env: "OPENROUTER_API_KEY",
    label: "OpenRouter",
    prefix: "openrouter/",
    help: "https://openrouter.ai/keys",
  },
] as const;

export function configuredProviders(
  env: Record<string, string | undefined>,
): Provider[] {
  return PROVIDERS.filter((provider) => Boolean(env[provider.env]?.trim()));
}

export function providerForModel(model: string): Provider | undefined {
  return PROVIDERS.find((provider) => model.startsWith(provider.prefix));
}
