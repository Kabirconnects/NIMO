import { generateText, isStepCount } from "ai";
import {
  getModel,
  getProviderOptions,
  type ModelId,
  type Effort,
} from "../models/registry.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { getToolsForMode } from "./tools/tool-manager.js";
import type { AgentMode } from "./tools/tools-mode-types.js";
import { buildMemoryContext, MEMORY_CONTEXT_GUIDANCE, memoryService } from "@workspace/memory";

const MEMORY_OWNER_ID = process.env.PAME_OWNER_ID ?? "local";
// Set so tools can see the active mode: Chat/Plan don't have write tools
// at all (enforced by tools-mode.config), Auto does. ALLOW_WRITE env is a
// secondary belt-and-suspenders check.
export function setAgentMode(m: AgentMode) { process.env.PAME_MODE = m; }

export async function runAgent(
  prompt: string,
  mode: AgentMode,
  modelId: ModelId = "anthropic/claude-sonnet-4-5",
  effort: Effort = "medium",
) {
  setAgentMode(mode);
  const config = getModel(modelId);
  const agentMode = getToolsForMode(mode);
  const start = Date.now();

  // PAME: recall memories relevant to THIS message — the brain remembers the
  // connections, not the whole graph.
  const ctx = buildMemoryContext(MEMORY_OWNER_ID, prompt);
  const skills = memoryService.loadSkills(MEMORY_OWNER_ID, prompt, 3);
  const memoryBlock = ctx.promptBlock ? `${MEMORY_CONTEXT_GUIDANCE}\n\n${ctx.promptBlock}` : "";

  console.log(`[agent] start model=${modelId} effort=${effort} mode=${mode}`);

  const closingInstruction = "\n\nAfter all tool calls, end your turn with a short natural-language summary (1-2 sentences) of what you did. Blank text is never acceptable — always summarize, in plain English, what tools you called and what you learned.";

  const result = await generateText({
    model: config.model,
    system: buildSystemPrompt(modelId, mode) + closingInstruction + (memoryBlock ? `\n\n${memoryBlock}` : ""),
    prompt,
    stopWhen: isStepCount(30),
    tools: agentMode,
    providerOptions: getProviderOptions(modelId, effort),
    onStepFinish: (step) => {
      console.log(
        `[agent] +${Date.now() - start}ms`,
        "tools:",
        step.toolCalls?.map((c) => c.toolName).join(", ") || "-",
        "in:",
        step.usage.inputTokens,
        "out:",
        step.usage.outputTokens,
        "think:",
        step.usage.outputTokenDetails?.reasoningTokens,
      );
    },
  });

  // PAME: save this turn as an experience and learn from it.
  // Every turn forms part of the brain — extraction runs afterwards.
  try {
    memoryService.remember({
      ownerId: MEMORY_OWNER_ID,
      content: prompt,
      type: "message",
    });
    // Toddler-learning: always remember what we did this turn ("Did: ..."),
    // so the next turn begins knowing "what we are doing now" — one
    // continuous stream, newest-first, never a per-session concept.
    const toolsUsed = result.steps.flatMap((s) => s.toolCalls?.map((c) => c.toolName) ?? []);
    if (result.text) {
      memoryService.remember({
        ownerId: MEMORY_OWNER_ID,
        content: `Did: ${result.text.slice(0, 900)}`,
        type: "message",
      });
      // Autonomous learning: if no skill fired for this prompt, distill
      // what happened into a candidate skill so next time it starts smarter.
      const usedSkills = ctx.promptBlock.includes("Skills you can use now") ? skills.length : 0;
      if (usedSkills === 0) {
        const proposed = memoryService.proposeSkillFromExperience({
          ownerId: MEMORY_OWNER_ID,
          prompt,
          response: result.text,
          toolsUsed,
        });
        if (proposed.length > 0 && proposed[0]) {
          console.log(`[agent] autonomous skill proposed: ${proposed[0].name}`);
        }
      } else {
        // Evolve: promote/demote/archive skills by track record.
        const evo = memoryService.evolveSkills(MEMORY_OWNER_ID);
        if (evo.promoted || evo.archived) {
          console.log(`[agent] skills evolved: +${evo.promoted} promoted, -${evo.archived} archived`);
        }
      }
    }
  } catch (err) {
    console.error("[agent] memory write failed:", err);
  }

  // Fallback: never return blank text. If the model only called tools and
  // didn't summarize, synthesize a summary from what actually happened.
  if (!result.text.trim()) {
    const toolsUsed = result.steps.flatMap((s) => s.toolCalls?.map((c) => c.toolName) ?? []);
    const summary = toolsUsed.length > 0
      ? `I used tools: ${toolsUsed.join(", ")}. See memory for details.`
      : "I processed your request but had no additional output.";
    (result as { text: string }).text = summary;
    console.log(`[agent] empty-text fallback: "${summary}"`);
  }

  console.log(
    `[agent] done in ${Date.now() - start}ms, steps=${result.steps.length}`,
  );

  return result;
}
