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


export const AgentSettings = z.object({

})

export const AgentSettingsSchema = z.object({
  modelId: z.string().min(1),
  provider: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
});
