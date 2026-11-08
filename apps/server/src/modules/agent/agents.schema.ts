import { z } from "zod";
import { MODEL_IDS, EFFORT_LEVELS } from "@workspace/agents";

export const chatSchema = z.object({
  prompt: z.string().trim().min(1).max(10000),
  mode: z.enum(["Chat", "Plan", "Auto"]).optional(),
  modelId: z.enum(MODEL_IDS).optional(),
  effort: z.enum(EFFORT_LEVELS).optional(),
});