import mongoose, { Schema, type InferSchemaType } from "mongoose"

const agentSettingsSchema = new Schema(
  {
    NIMO_WORKSPACE: {
      type: String,
      required: true,
      trim: true,
    },

    ANTHROPIC_API_KEY: {
      type: String,
      trim: true,
      select: false,
    },

    GOOGLE_GENERATIVE_AI_API_KEY: {
      type: String,
      trim: true,
      select: false,
    },

    DEEPSEEK_API_KEY: {
      type: String,
      trim: true,
      select: false,
    },

    GROQ_API_KEY: {
      type: String,
      trim: true,
      select: false,
    },

    OPENROUTER_API_KEY: {
      type: String,
      trim: true,
      select: false,
    },

    AI_MODEL: String,
    AI_EFFORT: String,

    AI_CONFIRM_DESTRUCTIVE: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export type AgentSettingsType = InferSchemaType<typeof agentSettingsSchema>

const AgentSettings =
  mongoose.models.AgentSettings ||
  mongoose.model("AgentSettings", agentSettingsSchema)

export default AgentSettings
