import { Router, type IRouter } from "express";
import { detectArbitrageOpportunities } from "../lib/arbitrageDetection";

const router: IRouter = Router();

router.get("/v1/opportunities", (req, res) => {
  try {
    const minSpread = parseFloat((req.query.minSpread as string) || "0");
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);

    const live = detectArbitrageOpportunities()
      .filter((o) => o.spreadPercent >= minSpread)
      .slice(0, limit)
      .map((o, idx) => ({
        id: `live-${idx}`,
        detectedAt: new Date().toISOString(),
        buyVenue: o.buyVenue,
        sellVenue: o.sellVenue,
        buySource: o.buySource,
        sellSource: o.sellSource,
        pair: o.pair,
        buyPrice: o.buyPrice,
        sellPrice: o.sellPrice,
        spreadPercent: o.spreadPercent,
        profitUsd: o.profitUsd,
        gasCostEth: o.gasCostEth,
        netProfitUsd: o.netProfitUsd,
        buyLiquidity: o.buyLiquidity,
        sellLiquidity: o.sellLiquidity,
        status: "active",
        durationMs: null,
      }));

    res.json(live);
  } catch (err) {
    req.log.error({ err }, "Error fetching opportunities");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
