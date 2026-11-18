// packages/agents/src/index.ts
export {
  runAgent as default,
  runAgent,
  runAgentStream,
} from "./core/agent-loop.js";
export type {
  AgentRunResult,
  AgentStreamEvent,
  AgentUsage,
  RunAgentOptions,
} from "./core/agent-loop.js";
export type {
  ModelId,
  Effort,
  ModelProvider,
  ModelConfig,
  ModelCapability,
  ModelTier,
  ModelOption,
  ModelGroup,
} from "./models/registry.js";
export {
  isModelConfigured,
  MODEL_IDS,
  EFFORT_LEVELS,
  DEFAULT_MODEL_ID,
  RECOMMENDED_MODEL_ID,
  PROVIDER_LABELS,
  getDefaultModelId,
  getModelGroups,
  getModelOptions,
  isModelId,
  resolveModelId,
  supportsReasoning,
  supportsTools,
} from "./models/registry.js";
