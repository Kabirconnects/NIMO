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