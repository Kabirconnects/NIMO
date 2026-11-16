import { z } from "zod";
import { MODEL_IDS, EFFORT_LEVELS } from "@workspace/agents";

export const chatSchema = z.object({
  prompt: z.string().trim().min(1).max(10000),
  mode: z.enum(["Chat", "Plan", "Auto"]).optional(),
  modelId: z.enum(MODEL_IDS).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
  /**
   * Set by the human/client only after an explicit destructive-operation
   * confirmation prompt. The model cannot set this. It never grants access
   * by itself — it only unblocks delete tools in Auto mode.
   */
  confirmDestructive: z.boolean().optional(),
});


export const AgentSettingsSchema = z.object({
  NIMO_WORKSPACE: z.string().trim().min(1),

  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  AI_MODEL: z.string().trim().min(1).optional(),

  AI_EFFORT: z.string().trim().min(1).optional(),

  AI_CONFIRM_DESTRUCTIVE: z.boolean().optional(),
});

export type AgentSettingsInput = z.infer<
  typeof AgentSettingsSchema
>;
