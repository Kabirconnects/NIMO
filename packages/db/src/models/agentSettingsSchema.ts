
import mongoose, { Schema, type InferSchemaType } from "mongoose";

const agentSettingsSchema = new Schema({
  NIMO_WORKSPACE: {
    type: String,
    required: true,
    trim: true,
  },
  ANTHROPIC_API_KEY: {
    type: String,
    trim: true,
  },
  GOOGLE_GENERATIVE_AI_API_KEY: {
    type: String,
    trim: true,
  },
  DEEPSEEK_API_KEY: {
    type: String,
    trim: true,
  },
  GROQ_API_KEY: {
    type: String,
    trim: true,
  },
  OPENROUTER_API_KEY: {
    type: String,
    trim: true,
  },
  AI_MODEL: {
    type: String,
    trim: true,
  },
});

export type AgentSettingsType = InferSchemaType<
  typeof agentSettingsSchema
>;

const AgentSettings = mongoose.model(
  "AgentSettings",
  agentSettingsSchema
);

export default AgentSettings;
