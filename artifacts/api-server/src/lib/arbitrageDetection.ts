import { db } from "@workspace/db";
import { opportunitiesTable, pricesTable } from "@workspace/db/schema";
import { priceStore, PriceData } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";
import { exchangeFees } from "./cexIngestion";
import {
  isWithdrawBlocked,
  isDepositBlocked,
  hasContractMismatch,
} from "./currencyInfoCache";

// 0.3% min: below this the fee drag (0.2–0.4% total) makes it unprofitable
const MIN_SPREAD_PERCENT = 0.3;
// 5% max: real liquid CEX arb virtually never exceeds this; larger gaps
// are almost always ticker collisions or stale/erroneous data
const MAX_SPREAD_PERCENT = 5;
const TRADE_AMOUNT_USD = 100;
const MIN_LIQUIDITY_USD = 10_000;

// Known ticker collisions: same symbol listed on multiple exchanges but different underlying
// tokens. Pairs of (baseSymbol, venue1, venue2) where the comparison is invalid.
// Format: "BASE:venue1:venue2" and "BASE:venue2:venue1" are both blocked.
const TICKER_COLLISION_PAIRS = new Set<string>([
  // ELON — Dogelon Mars vs other ELON-named tokens
  "ELON:gate:mexc", "ELON:mexc:gate",
  "ELON:gate:kucoin", "ELON:kucoin:gate",
  "ELON:gate:okx", "ELON:okx:gate",
]);

const GAS_COSTS_USD: Record<string, number> = {
  ethereum: 20,
  arbitrum: 1,
  base: 0.5,
  bsc: 0.3,
  polygon: 0.1,
};

const DEX_FEE_RATE: Record<string, number> = {
  "Uniswap V3 / Ethereum": 0.0005,
  "Uniswap V3 / Arbitrum": 0.0005,
  "Uniswap V3 / Base": 0.0005,
  "PancakeSwap V3 / BSC": 0.0005,
  "Curve 3Pool / Ethereum": 0.0004,
};

/**
 * Best available liquidity indicator for a price entry.
 * DEX pairs carry pool liquidityUsd; CEX pairs carry 24h quote volume.
 * Returns undefined when neither is available.
 */
function effectiveLiquidity(p: PriceData): number | undefined {
  if (p.source === "dex") return p.liquidityUsd;
  return p.volume24h;
}

function getTradingFee(venue: string, source: string): number {
  if (source === "dex") {
    return DEX_FEE_RATE[venue] ?? 0.001;
  }
  return exchangeFees[venue] ?? 0.001;
}

function estimateGasCost(chain: string | null): number {
  if (!chain) return 0;
  return GAS_COSTS_USD[chain] ?? 2;
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
  type?: "cross" | "triangular";
}

/**
 * Triangular arbitrage: TOKEN/USDT vs TOKEN/BTC × BTC/USDT
 *
 * Within the same exchange, if the implied TOKEN/USDT from BTC quote differs
 * enough from the direct TOKEN/USDT price, a triangular loop is profitable.
 *
 * Requires TOKEN/USDT AND TOKEN/BTC AND BTC/USDT on the same venue.
 * Currently CEX scanners only ingest USDT pairs, so this runs over DEX data
 * from chainScanner where both base/BTC and base/USDT pools may exist.
 */
function detectTriangular(): ArbitrageOpportunity[] {
  const allPrices = priceStore.getAll();
  const cutoff    = new Date(Date.now() - 60_000);
  const fresh     = allPrices.filter((p) => p.updatedAt >= cutoff);

  // Build venue → pair → price maps
  const byVenuePair = new Map<string, Map<string, PriceData>>();
  for (const p of fresh) {
    if (!byVenuePair.has(p.venue)) byVenuePair.set(p.venue, new Map());
    byVenuePair.get(p.venue)!.set(p.pair, p);
  }

  const opportunities: ArbitrageOpportunity[] = [];

  for (const [venue, pairMap] of byVenuePair) {
    const btcUsdt = pairMap.get("BTC/USDT");
    if (!btcUsdt) continue;

    const btcPrice = btcUsdt.bid ?? btcUsdt.price;
    if (!btcPrice || btcPrice <= 0) continue;

    for (const [pair, tokenUsdt] of pairMap) {
      if (!pair.endsWith("/USDT") || pair === "BTC/USDT") continue;
      const base = pair.split("/")[0]!;

      const tokenBtc = pairMap.get(`${base}/BTC`);
      if (!tokenBtc) continue;

      // Implied USDT price via BTC route:
      //   buy TOKEN/USDT direct vs buy TOKEN/BTC then convert BTC/USDT
      const directAsk    = tokenUsdt.ask ?? tokenUsdt.price;
      const btcRouteAsk  = (tokenBtc.ask ?? tokenBtc.price) * (btcUsdt.ask ?? btcUsdt.price);

      if (!directAsk || !btcRouteAsk || directAsk <= 0 || btcRouteAsk <= 0) continue;

      let buyPrice: number, sellPrice: number, buyRoute: string, sellRoute: string;

      if (directAsk < btcRouteAsk) {
        buyPrice  = directAsk;
        sellPrice = btcRouteAsk;
        buyRoute  = `${venue} (direct)`;
        sellRoute = `${venue} (via BTC)`;
      } else {
        buyPrice  = btcRouteAsk;
        sellPrice = directAsk;
        buyRoute  = `${venue} (via BTC)`;
        sellRoute = `${venue} (direct)`;
      }

      const spreadPercent = ((sellPrice - buyPrice) / buyPrice) * 100;
      if (spreadPercent < MIN_SPREAD_PERCENT || spreadPercent > MAX_SPREAD_PERCENT) continue;

      const source    = tokenUsdt.source;
      const feeRate   = getTradingFee(venue, source) * 3; // three legs
      const profitUsd = ((spreadPercent / 100) - feeRate) * TRADE_AMOUNT_USD;
      const gasCost   = source === "dex" ? (estimateGasCost(tokenUsdt.chain) * 3) : 0;
      const netProfit = profitUsd - gasCost;

      if (netProfit <= 0) continue;

      opportunities.push({
        type:        "triangular",
        buyVenue:    buyRoute,
        sellVenue:   sellRoute,
        buySource:   source,
        sellSource:  source,
        pair:        `${base}/USDT`,
        buyPrice,
        sellPrice,
        spreadPercent,
        profitUsd,
        gasCostEth:  gasCost,
        netProfitUsd: netProfit,
        buyLiquidity:  tokenUsdt.liquidityUsd ?? null,
        sellLiquidity: tokenBtc.liquidityUsd  ?? null,
      });
    }
  }

  return opportunities;
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

        // Reject likely ticker collisions: same symbol = different tokens on each exchange
        if (spreadPercent > MAX_SPREAD_PERCENT) continue;

        // Reject explicitly flagged known ticker collisions (e.g. ELON on Gate vs MEXC)
        const baseSymbol = pair.split("/")[0];
        const collisionKey = `${baseSymbol}:${buyAt.venue}:${sellAt.venue}`;
        if (TICKER_COLLISION_PAIRS.has(collisionKey)) continue;

        // ── Filter 2: Liquidity < $10k ────────────────────────────────────────
        // Use DEX pool liquidity for on-chain venues; 24h volume as proxy for CEX.
        // Only reject when the figure is known and below threshold.
        const buyLiq = effectiveLiquidity(buyAt);
        const sellLiq = effectiveLiquidity(sellAt);
        if (buyLiq !== undefined && buyLiq < MIN_LIQUIDITY_USD) continue;
        if (sellLiq !== undefined && sellLiq < MIN_LIQUIDITY_USD) continue;

        // ── Filter 3: Contract address mismatch ───────────────────────────────
        // If both venues expose the same token's contract address on a shared
        // chain and they differ, this is a different-token collision.
        if (hasContractMismatch(baseSymbol, buyAt.venue, sellAt.venue)) continue;

        // ── Filter 4: Withdraw / deposit disabled ─────────────────────────────
        // You need to withdraw from the buy exchange and deposit on the sell
        // exchange when rebalancing. If either side is closed, skip.
        if (isWithdrawBlocked(buyAt.venue, baseSymbol)) continue;
        if (isDepositBlocked(sellAt.venue, baseSymbol)) continue;

        const buyFeeRate = getTradingFee(buyAt.venue, buyAt.source);
        const sellFeeRate = getTradingFee(sellAt.venue, sellAt.source);
        const totalFeeRate = buyFeeRate + sellFeeRate;
        const profitUsd = ((spreadPercent / 100) - totalFeeRate) * TRADE_AMOUNT_USD;
        const gasCostEth = estimateGasCost(buyAt.chain) + estimateGasCost(sellAt.chain ?? null);
        const netProfitUsd = profitUsd - gasCostEth;

        if (netProfitUsd <= 0) continue;

        opportunities.push({
          type: "cross",
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

  // Merge in triangular opportunities
  const triangular = detectTriangular();
  opportunities.push(...triangular);

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
