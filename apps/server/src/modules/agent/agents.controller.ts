import type { Request, Response } from "express"
import { APICallError, RetryError } from "ai"
import {
  runAgentStream,
  isModelConfigured,
  type AgentStreamEvent,
  type ModelId,
  type Effort,
} from "@workspace/agents"
import { MemoryAccessError } from "@workspace/memory"
import { chatSchema } from "./agents.schema.js"
import { resolveRequestIdentity, IdentityError } from "./identity.js"
import { env } from "../../lib/env.js"

//{
// "prompt": "who are you?",
// "mode": "Auto"  => "Chat", "Plan", "Auto"
// "effort": "low" ==> "none" | "low" | "medium" | "high"
// "confirmDestructive": false
//}

/** How often to poke the socket so proxies keep the stream open. */
const HEARTBEAT_MS = 15_000

function sseFrame(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function chatWithAgent(req: Request, res: Response) {
  try {
    const parsed = chatSchema.safeParse(req.body)

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "Invalid request",
        details: parsed.error.flatten(),
      })
    }

    // Identity comes from the auth layer (req.user), never from the body.
    let identity
    try {
      identity = resolveRequestIdentity(req)
    } catch (error) {
      if (error instanceof IdentityError) {
        return res.status(error.statusCode).json({
          success: false,
          error: error.message,
        })
      }
      throw error
    }

    const modelId: ModelId = parsed.data.modelId ?? env.AI_MODEL
    const mode = parsed.data.mode ?? "Auto"
    // const mode = parsed.data.mode ?? "Chat";
    const effort: Effort = parsed.data.effort ?? "medium" // "none" | "low" | "medium" | "high"

    if (!isModelConfigured(modelId)) {
      return res.status(400).json({
        success: false,
        error: `Model "${modelId}" is not configured on the server`,
      })
    }

    // ------------------------------------------------------------------
    // From here on the response is an SSE stream: every step (reasoning,
    // text, tool call, tool result, usage) is pushed as its own frame so the
    // client can render the turn as it happens instead of waiting for the
    // final JSON payload.
    // ------------------------------------------------------------------
    res.status(200)
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
    res.setHeader("Cache-Control", "no-cache, no-transform")
    res.setHeader("Connection", "keep-alive")
    // Tell nginx and friends not to buffer the stream.
    res.setHeader("X-Accel-Buffering", "no")
    res.flushHeaders?.()

    const abort = new AbortController()
    res.on("close", () => {
      // Client went away before the turn finished — stop burning tokens.
      if (!res.writableEnded) abort.abort()
    })

    const send = (event: AgentStreamEvent) => {
      if (res.writableEnded || res.destroyed) return
      res.write(sseFrame(event))
    }

    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) return
      // SSE comment frame — ignored by the client, keeps the pipe warm.
      res.write(": ping\n\n")
    }, HEARTBEAT_MS)

    try {
      await runAgentStream(parsed.data.prompt, mode, modelId, effort, {
        ownerId: identity.ownerId,
        destructiveConfirmed: parsed.data.confirmDestructive === true,
        abortSignal: abort.signal,
        onEvent: send,
      })
    } catch (error) {
      console.error("Agent execution failed:", error)
      send({
        type: "error",
        message:
          error instanceof MemoryAccessError
            ? error.message
            : "Agent execution failed",
      })
    } finally {
      clearInterval(heartbeat)
      if (!res.writableEnded && !res.destroyed) res.end()
    }

    return
  } catch (error) {
    if (error instanceof MemoryAccessError) {
      const status = error.code === "no_identity" ? 401 : 403
      return res.status(status).json({
        success: false,
        error: error.message,
      })
    }

    const cause = RetryError.isInstance(error) ? error.lastError : error

    if (APICallError.isInstance(cause)) {
      console.error("Provider error:", {
        status: cause.statusCode,
        url: cause.url,
        body: cause.responseBody,
      })
    } else {
      console.error("Agent execution failed:", error)
    }

    if (res.headersSent) {
      // Stream already started — report the failure inside the stream.
      if (!res.writableEnded && !res.destroyed) {
        res.write(
          sseFrame({ type: "error", message: "Agent execution failed" })
        )
        res.end()
      }
      return
    }

    return res.status(500).json({
      success: false,
      error: "Agent execution failed",
    })
  }
}
