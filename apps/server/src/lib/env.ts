import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(4000),

  CLIENT_URL: z.string().default("http://localhost:5173"),

  HOST: z.string().default("127.0.0.1"),

  AI_MODEL: z.string().min(1, "AI_MODEL is required"),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("Invalid environment variables:");
  console.error(z.treeifyError(parsedEnv.error));

  throw new Error("Invalid environment configuration");
}

export const env = parsedEnv.data;

export type Env = typeof env;
