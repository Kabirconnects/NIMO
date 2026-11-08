
import { Router, type Router as RouterType } from "express";

const router: RouterType = Router();

router.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "Nimo-api",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

export default router;
