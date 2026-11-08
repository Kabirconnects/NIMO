import express, { type Express } from "express";
import { healthRoutes } from "./modules/health/index.js";
import agentRouter from "./modules/agent/agents.routes.js"

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use("/health", healthRoutes);
  app.use("/agent", agentRouter);

  return app;
}