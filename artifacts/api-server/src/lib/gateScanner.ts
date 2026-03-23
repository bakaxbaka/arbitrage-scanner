/**
 * Gate.io Cross-Market Scanner
 *
 * Fetches all Gate.io USDT spot pairs, then bulk-fetches tickers from
 * Binance, Bybit, OKX, KuCoin, and MEXC to find price discrepancies.
 * All prices land in priceStore; the existing arbitrage engine picks up
 * Gate.io ↔ other-CEX spreads automatically.
 */

import { priceStore } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";
import { WATCHLIST_SYMBOLS } from "./watchlist";

const POLL_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 15_000;

// ─── Types ───────────────────────────────────────────────────────────────────

interface GateTicker {
  currency_pair: string;
  last: string;
  bid: string;
  ask: string;
  quote_volume: string;
  change_percentage?: string;
}

interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  quoteVolume: string;
}

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  bid1Price: string;
  ask1Price: string;
  turnover24h: string;
}

interface OkxTicker {
  instId: string;
  last: string;
  bidPx: string;
  askPx: string;
  volCcy24h: string;
}

interface KucoinTicker {
  symbol: string;
  last: string;
  buy: string;
  sell: string;
  volValue: string;
}

interface MexcTicker {
  symbol: string;
  lastPrice: string;
  bidPrice: string;
  askPrice: string;
  quoteVolume: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let gatePairCount = 0;

export function getGatePairCount(): number {
  return gatePairCount;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "Gate scanner HTTP error");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.warn({ url, err }, "Gate scanner fetch failed");
    return null;
  }
}

// ─── Gate.io ─────────────────────────────────────────────────────────────────

async function fetchGateTickers(): Promise<Map<string, GateTicker>> {
  const tickers = await fetchJson<GateTicker[]>(
    "https://api.gateio.ws/api/v4/spot/tickers"
  );
  const result = new Map<string, GateTicker>();
  if (!tickers) return result;

  for (const t of tickers) {
    // Only USDT pairs; skip obvious stablecoin pairs
    if (!t.currency_pair.endsWith("_USDT")) continue;
    const base = t.currency_pair.replace("_USDT", "");
    if (!base || base === "USDC" || base === "DAI" || base === "BUSD") continue;
    const price = parseFloat(t.last);
    if (!price || isNaN(price) || price <= 0) continue;
    result.set(base.toUpperCase(), t);
  }

  return result;
}

// ─── Binance ─────────────────────────────────────────────────────────────────

async function fetchBinanceTickers(): Promise<Map<string, BinanceTicker>> {
  const tickers = await fetchJson<BinanceTicker[]>(
    "https://api.binance.com/api/v3/ticker/bookTicker"
  );
  const result = new Map<string, BinanceTicker>();
  if (!tickers) return result;
  for (const t of tickers) {
    if (!t.symbol.endsWith("USDT")) continue;
    const base = t.symbol.replace("USDT", "");
    result.set(base.toUpperCase(), t);
  }
  return result;
}

// ─── Bybit ───────────────────────────────────────────────────────────────────

async function fetchBybitTickers(): Promise<Map<string, BybitTicker>> {
  const data = await fetchJson<{ result?: { list?: BybitTicker[] } }>(
    "https://api.bybit.com/v5/market/tickers?category=spot"
  );
  const result = new Map<string, BybitTicker>();
  const list = data?.result?.list;
  if (!list) return result;
  for (const t of list) {
    if (!t.symbol.endsWith("USDT")) continue;
    const base = t.symbol.replace("USDT", "");
    result.set(base.toUpperCase(), t);
  }
  return result;
}

// ─── OKX ─────────────────────────────────────────────────────────────────────

async function fetchOkxTickers(): Promise<Map<string, OkxTicker>> {
  const data = await fetchJson<{ data?: OkxTicker[] }>(
    "https://www.okx.com/api/v5/market/tickers?instType=SPOT"
  );
  const result = new Map<string, OkxTicker>();
  const list = data?.data;
  if (!list) return result;
  for (const t of list) {
    if (!t.instId.endsWith("-USDT")) continue;
    const base = t.instId.replace("-USDT", "");
    result.set(base.toUpperCase(), t);
  }
  return result;
}

// ─── KuCoin ──────────────────────────────────────────────────────────────────

async function fetchKucoinTickers(): Promise<Map<string, KucoinTicker>> {
  const data = await fetchJson<{ data?: { ticker?: KucoinTicker[] } }>(
    "https://api.kucoin.com/api/v1/market/allTickers"
  );
  const result = new Map<string, KucoinTicker>();
  const list = data?.data?.ticker;
  if (!list) return result;
  for (const t of list) {
    if (!t.symbol.endsWith("-USDT")) continue;
    const base = t.symbol.replace("-USDT", "");
    result.set(base.toUpperCase(), t);
  }
  return result;
}

// ─── MEXC ────────────────────────────────────────────────────────────────────

async function fetchMexcTickers(): Promise<Map<string, MexcTicker>> {
  const tickers = await fetchJson<MexcTicker[]>(
    "https://api.mexc.com/api/v3/ticker/bookTicker"
  );
  const result = new Map<string, MexcTicker>();
  if (!tickers) return result;
  for (const t of tickers) {
    if (!t.symbol.endsWith("USDT")) continue;
    const base = t.symbol.replace("USDT", "");
    result.set(base.toUpperCase(), t);
  }
  return result;
}

// ─── Store helpers ───────────────────────────────────────────────────────────

function storePrice(
  venue: string,
  base: string,
  price: number,
  bid: number | undefined,
  ask: number | undefined,
  volume24h: number | undefined
) {
  if (!price || isNaN(price) || price <= 0) return;
  const pair = `${base}/USDT`;

  priceStore.set({
    source: "cex",
    venue,
    chain: null,
    pair,
    baseToken: base,
    quoteToken: "USDT",
    price,
    bid,
    ask,
    volume24h,
    updatedAt: new Date(),
  });

  broadcast("price_update", { source: "cex", venue, pair, price });
}

// ─── Main scan ───────────────────────────────────────────────────────────────

async function runScan() {
  logger.info("Gate.io cross-market scan starting...");

  const [gateTickers, binanceTickers, bybitTickers, okxTickers, kucoinTickers, mexcTickers] =
    await Promise.all([
      fetchGateTickers(),
      fetchBinanceTickers(),
      fetchBybitTickers(),
      fetchOkxTickers(),
      fetchKucoinTickers(),
      fetchMexcTickers(),
    ]);

  gatePairCount = gateTickers.size;

  let storedCount = 0;

  for (const [base, gate] of gateTickers) {
    const pair = `${base}/USDT`;
    const gatePrice = parseFloat(gate.last);
    const gateBid = parseFloat(gate.bid) || undefined;
    const gateAsk = parseFloat(gate.ask) || undefined;
    const gateVol = parseFloat(gate.quote_volume) || undefined;

    // Store Gate.io price
    storePrice("gate", base, gatePrice, gateBid, gateAsk, gateVol);
    storedCount++;

    // Store Binance price if listed there
    const bn = binanceTickers.get(base);
    if (bn) {
      const p = parseFloat(bn.lastPrice);
      storePrice("binance", base, p, parseFloat(bn.bidPrice) || undefined, parseFloat(bn.askPrice) || undefined, undefined);
    }

    // Store Bybit price
    const bb = bybitTickers.get(base);
    if (bb) {
      const p = parseFloat(bb.lastPrice);
      storePrice("bybit", base, p, parseFloat(bb.bid1Price) || undefined, parseFloat(bb.ask1Price) || undefined, parseFloat(bb.turnover24h) || undefined);
    }

    // Store OKX price
    const ok = okxTickers.get(base);
    if (ok) {
      const p = parseFloat(ok.last);
      storePrice("okx", base, p, parseFloat(ok.bidPx) || undefined, parseFloat(ok.askPx) || undefined, parseFloat(ok.volCcy24h) || undefined);
    }

    // Store KuCoin price
    const kc = kucoinTickers.get(base);
    if (kc) {
      const p = parseFloat(kc.last);
      storePrice("kucoin", base, p, parseFloat(kc.buy) || undefined, parseFloat(kc.sell) || undefined, parseFloat(kc.volValue) || undefined);
    }

    // Store MEXC price
    const mx = mexcTickers.get(base);
    if (mx) {
      const p = parseFloat(mx.lastPrice);
      storePrice("mexc", base, p, parseFloat(mx.bidPrice) || undefined, parseFloat(mx.askPrice) || undefined, undefined);
    }
  }

  // Second pass: store prices for watchlist symbols not found on Gate.io
  // but available on KuCoin, MEXC, or OKX
  let watchlistExtra = 0;
  for (const base of WATCHLIST_SYMBOLS) {
    if (gateTickers.has(base)) continue; // already handled above

    let found = false;

    const kc = kucoinTickers.get(base);
    if (kc) {
      const p = parseFloat(kc.last);
      storePrice("kucoin", base, p, parseFloat(kc.buy) || undefined, parseFloat(kc.sell) || undefined, parseFloat(kc.volValue) || undefined);
      found = true;
    }

    const mx = mexcTickers.get(base);
    if (mx) {
      const p = parseFloat(mx.lastPrice);
      storePrice("mexc", base, p, parseFloat(mx.bidPrice) || undefined, parseFloat(mx.askPrice) || undefined, undefined);
      found = true;
    }

    const ok = okxTickers.get(base);
    if (ok) {
      const p = parseFloat(ok.last);
      storePrice("okx", base, p, parseFloat(ok.bidPx) || undefined, parseFloat(ok.askPx) || undefined, parseFloat(ok.volCcy24h) || undefined);
      found = true;
    }

    const bn = binanceTickers.get(base);
    if (bn) {
      const p = parseFloat(bn.lastPrice);
      storePrice("binance", base, p, parseFloat(bn.bidPrice) || undefined, parseFloat(bn.askPrice) || undefined, undefined);
      found = true;
    }

    const bb = bybitTickers.get(base);
    if (bb) {
      const p = parseFloat(bb.lastPrice);
      storePrice("bybit", base, p, parseFloat(bb.bid1Price) || undefined, parseFloat(bb.ask1Price) || undefined, parseFloat(bb.turnover24h) || undefined);
      found = true;
    }

    if (found) watchlistExtra++;
  }

  logger.info(
    {
      gateListings: gateTickers.size,
      stored: storedCount,
      watchlistExtra,
      binanceOverlap: [...gateTickers.keys()].filter((b) => binanceTickers.has(b)).length,
      bybitOverlap: [...gateTickers.keys()].filter((b) => bybitTickers.has(b)).length,
      okxOverlap: [...gateTickers.keys()].filter((b) => okxTickers.has(b)).length,
      kucoinOverlap: [...gateTickers.keys()].filter((b) => kucoinTickers.has(b)).length,
      mexcOverlap: [...gateTickers.keys()].filter((b) => mexcTickers.has(b)).length,
    },
    "Gate.io scan complete"
  );
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startGateScanner() {
  logger.info("Starting Gate.io cross-market scanner...");

  runScan().catch((err) => logger.error({ err }, "Gate scanner initial run failed"));

  setInterval(() => {
    runScan().catch((err) => logger.error({ err }, "Gate scanner poll failed"));
  }, POLL_INTERVAL_MS);
}
