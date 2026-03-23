import { Router, type IRouter } from "express";
import { priceStore } from "../lib/priceStore";

const router: IRouter = Router();

router.get("/v1/prices", (req, res) => {
  const { pair, source, chain } = req.query as Record<string, string>;

  let prices = priceStore.getAll();

  if (pair) {
    prices = prices.filter((p) => p.pair.toLowerCase() === pair.toLowerCase());
  }
  if (source && source !== "all") {
    prices = prices.filter((p) => p.source === source);
  }
  if (chain) {
    prices = prices.filter((p) => p.chain === chain);
  }

  const result = prices.map((p, idx) => ({
    id: idx + 1,
    time: p.updatedAt.toISOString(),
    source: p.source,
    venue: p.venue,
    chain: p.chain ?? null,
    pair: p.pair,
    baseToken: p.baseToken,
    quoteToken: p.quoteToken,
    price: p.price,
    volume24h: p.volume24h ?? null,
    liquidityUsd: p.liquidityUsd ?? null,
    bid: p.bid ?? null,
    ask: p.ask ?? null,
  }));

  res.json(result);
});

export default router;
