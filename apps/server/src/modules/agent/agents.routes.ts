import express, { type Router } from "express";
import { chatWithAgent } from "./agents.controller.js";

const router: Router = express.Router();

router.post("/", chatWithAgent);

export default router;