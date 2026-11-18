import express, { type Router } from "express";
import { chatWithAgent, listModels } from "./agents.controller.js";

const router: Router = express.Router();

router.get("/models", listModels);
router.post("/", chatWithAgent);

export default router;