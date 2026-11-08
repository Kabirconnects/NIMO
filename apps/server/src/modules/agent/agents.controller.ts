import type { Request, Response } from "express";
import { APICallError, RetryError } from "ai";
import runAgent, {
  isModelConfigured,
  type ModelId,
  type Effort,
} from "@workspace/agents";
import { chatSchema } from "./agents.schema.js";
import { env } from "../../lib/env.js";

//{
// "prompt": "who are you?",
// "mode": "Auto"  => "Chat", "Plan", "Auto"
// "effort": "low" ==> "none" | "low" | "medium" | "high"
//}

export async function chatWithAgent(req: Request, res: Response) {
  try {
    const parsed = chatSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        details: parsed.error.flatten(),
      });
    }

    const modelId: ModelId = parsed.data.modelId ?? env.AI_MODEL;
    const mode = parsed.data.mode ?? "Chat";
    const effort: Effort = parsed.data.effort ?? "medium"; // "none" | "low" | "medium" | "high"

    if (!isModelConfigured(modelId)) {
      return res.status(400).json({
        success: false,
        error: `Model "${modelId}" is not configured on the server`,
      });
    }

    const result = await runAgent(parsed.data.prompt, mode, modelId, effort);

    return res.status(200).json({
      success: true,
      result: {
        text: result.text,
        usage: result.usage,
      },
    });
  } catch (error) {
    const cause = RetryError.isInstance(error) ? error.lastError : error;

    if (APICallError.isInstance(cause)) {
      console.error("Provider error:", {
        status: cause.statusCode,
        url: cause.url,
        body: cause.responseBody,
      });
    } else {
      console.error("Agent execution failed:", error);
    }

    return res.status(500).json({
      success: false,
      error: "Agent execution failed",
    });
  }
}
