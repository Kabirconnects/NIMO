import express, { type Express } from "express";
import { env } from "./lib/env.js";


import cors from "cors";
import cookieParser from "cookie-parser";

import { healthRoutes } from "./modules/health/index.js";
import agentRouter from "./modules/agent/agents.routes.js"
import usersRouter from "./modules/user/users.routes.js"

export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: [env.CLIENT_URL],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  )

  app.use(express.json());
  app.use(cookieParser());

  app.use("/health", healthRoutes);
  app.use("/agent", agentRouter);
  app.use("/users", usersRouter)

  return app;
}