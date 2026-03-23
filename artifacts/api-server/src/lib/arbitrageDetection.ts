import { db } from "@workspace/db";
import { opportunitiesTable, pricesTable } from "@workspace/db/schema";
import { priceStore, PriceData } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";

const MIN_SPREAD_PERCENT = 0.05;
const TRADE_AMOUNT_USD = 10_000;

const GAS_COSTS_USD: Record<string, number> = {
  ethereum: 20,
  arbitrum: 1,
  base: 0.5,
  bsc: 0.3,
  polygon: 0.1,
};

function estimateGasCost(chain: string | null): number {
  if (!chain) return 5;
  return GAS_COSTS_USD[chain] ?? 5;
}

interface ArbitrageOpportunity {
  buyVenue: string;
  sellVenue: string;
  buySource: string;
  sellSource: string;
  pair: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  profitUsd: number;
  gasCostEth: number | null;
  netProfitUsd: number;
  buyLiquidity: number | null;
  sellLiquidity: number | null;
}

export function detectArbitrageOpportunities(): ArbitrageOpportunity[] {
  const allPrices = priceStore.getAll();
  const byPair = new Map<string, PriceData[]>();

  for (const p of allPrices) {
    if (!byPair.has(p.pair)) byPair.set(p.pair, []);
    byPair.get(p.pair)!.push(p);
  }

  const opportunities: ArbitrageOpportunity[] = [];
  const cutoff = new Date(Date.now() - 60_000);

  for (const [pair, prices] of byPair) {
    const fresh = prices.filter((p) => p.updatedAt >= cutoff);
    if (fresh.length < 2) continue;

    for (let i = 0; i < fresh.length; i++) {
      for (let j = 0; j < fresh.length; j++) {
        if (i === j) continue;
        const buyAt = fresh[i];
        const sellAt = fresh[j];

        const buyPrice = buyAt.ask ?? buyAt.price;
        const sellPrice = sellAt.bid ?? sellAt.price;

        if (sellPrice <= buyPrice) continue;

        const spreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100;
        if (spreadPercent < MIN_SPREAD_PERCENT) continue;

        const profitUsd = (spreadPercent / 100) * TRADE_AMOUNT_USD;
        const gasCostEth = estimateGasCost(buyAt.chain) + estimateGasCost(sellAt.chain ?? null);
        const netProfitUsd = profitUsd - gasCostEth;

        if (netProfitUsd <= 0) continue;

        opportunities.push({
          buyVenue: buyAt.venue,
          sellVenue: sellAt.venue,
          buySource: buyAt.source,
          sellSource: sellAt.source,
          pair,
          buyPrice,
          sellPrice,
          spreadPercent,
          profitUsd,
          gasCostEth,
          netProfitUsd,
          buyLiquidity: buyAt.liquidityUsd ?? null,
          sellLiquidity: sellAt.liquidityUsd ?? null,
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.spreadPercent - a.spreadPercent);
}

const recentOpportunityKeys = new Set<string>();

async function persistAndBroadcast(opps: ArbitrageOpportunity[]) {
  for (const opp of opps.slice(0, 20)) {
    const key = `${opp.pair}:${opp.buyVenue}:${opp.sellVenue}`;

    try {
      const [inserted] = await db
        .insert(opportunitiesTable)
        .values({
          buyVenue: opp.buyVenue,
          sellVenue: opp.sellVenue,
          buySource: opp.buySource,
          sellSource: opp.sellSource,
          pair: opp.pair,
          buyPrice: opp.buyPrice.toFixed(18),
          sellPrice: opp.sellPrice.toFixed(18),
          spreadPercent: opp.spreadPercent.toFixed(4),
          profitUsd: opp.profitUsd.toFixed(2),
          gasCostEth: opp.gasCostEth != null ? opp.gasCostEth.toFixed(18) : null,
          netProfitUsd: opp.netProfitUsd.toFixed(2),
          buyLiquidity: opp.buyLiquidity != null ? opp.buyLiquidity.toFixed(2) : null,
          sellLiquidity: opp.sellLiquidity != null ? opp.sellLiquidity.toFixed(2) : null,
          status: "active",
        })
        .returning();

      broadcast("opportunity", {
        id: inserted.id,
        detectedAt: inserted.detectedAt,
        ...opp,
      });
    } catch (err) {
      logger.error({ err }, "Failed to persist opportunity");
    }
  }
}

async function persistPrices() {
  const allPrices = priceStore.getAll();
  if (allPrices.length === 0) return;

  const rows = allPrices.map((p) => ({
    source: p.source,
    venue: p.venue,
    chain: p.chain ?? undefined,
    pair: p.pair,
    baseToken: p.baseToken,
    quoteToken: p.quoteToken,
    price: p.price.toFixed(18),
    volume24h: p.volume24h != null ? p.volume24h.toFixed(18) : undefined,
    liquidityUsd: p.liquidityUsd != null ? p.liquidityUsd.toFixed(2) : undefined,
    bid: p.bid != null ? p.bid.toFixed(18) : undefined,
    ask: p.ask != null ? p.ask.toFixed(18) : undefined,
  }));

  try {
    await db.insert(pricesTable).values(rows);
  } catch (err) {
    logger.error({ err }, "Failed to persist prices");
  }
}

export function startArbitrageDetection() {
  logger.info("Starting arbitrage detection engine...");

  setInterval(() => {
    try {
      const opps = detectArbitrageOpportunities();
      if (opps.length > 0) {
        logger.info({ count: opps.length }, "Arbitrage opportunities detected");
        persistAndBroadcast(opps).catch((err) =>
          logger.error({ err }, "Error persisting opportunities")
        );
      }

      broadcast("opportunities_update", {
        count: opps.length,
        top: opps.slice(0, 5),
      });
    } catch (err) {
      logger.error({ err }, "Arbitrage detection error");
    }
  }, 3000);

  setInterval(() => {
    persistPrices().catch((err) => logger.error({ err }, "Price persistence error"));
  }, 30000);
}
