import type { Request, Response } from "express";
import { APICallError, RetryError } from "ai";
import runAgent, {
  isModelConfigured,
  type ModelId,
  type Effort,
} from "@workspace/agents";
import { MemoryAccessError } from "@workspace/memory";
import { chatSchema } from "./agents.schema.js";
import { resolveRequestIdentity, IdentityError } from "./identity.js";
import { env } from "../../lib/env.js";

//{
// "prompt": "who are you?",
// "mode": "Auto"  => "Chat", "Plan", "Auto"
// "effort": "low" ==> "none" | "low" | "medium" | "high"
// "confirmDestructive": false
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

    // Identity comes from the auth layer (req.user), never from the body.
    let identity;
    try {
      identity = resolveRequestIdentity(req);
    } catch (error) {
      if (error instanceof IdentityError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        });
      }
      throw error;
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

    const result = await runAgent(parsed.data.prompt, mode, modelId, effort, {
      ownerId: identity.ownerId,
      destructiveConfirmed: parsed.data.confirmDestructive === true,
    });

    return res.status(200).json({
      success: true,
      result: {
        text: result.text,
        usage: result.usage,
      },
    });
  } catch (error) {
    if (error instanceof MemoryAccessError) {
      const status = error.code === "no_identity" ? 401 : 403;
      return res.status(status).json({
        success: false,
        error: error.message,
      });
    }

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
