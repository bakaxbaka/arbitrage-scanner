import { Router } from "express";
import { scanExitOpportunities } from "../lib/exitOptimizer";
import { logger } from "../lib/logger";

const router = Router();

router.post("/exit-optimizer/scan", async (req, res) => {
  const { token, amount } = req.body as { token?: string; amount?: number };

  if (!token || typeof token !== "string" || token.trim().length === 0) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const parsedAmount = Number(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  try {
    logger.info({ token, amount: parsedAmount }, "Exit optimizer scan started");
    const result = await scanExitOpportunities(token.trim(), parsedAmount);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "Exit optimizer scan failed");
    res.status(500).json({ error: "Scan failed" });
  }
});

export default router;
