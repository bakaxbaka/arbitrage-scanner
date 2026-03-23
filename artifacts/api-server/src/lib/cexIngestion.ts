import ccxws from "ccxws";
import ccxt from "ccxt";
import WebSocket from "ws";
import { priceStore } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";

const MONITORED_PAIRS = [
  { base: "BTC", quote: "USDT", pair: "BTC/USDT" },
  { base: "ETH", quote: "USDT", pair: "ETH/USDT" },
  { base: "SOL", quote: "USDT", pair: "SOL/USDT" },
  { base: "LINK", quote: "USDT", pair: "LINK/USDT" },
  { base: "UNI", quote: "USDT", pair: "UNI/USDT" },
  { base: "AAVE", quote: "USDT", pair: "AAVE/USDT" },
  { base: "BNB", quote: "USDT", pair: "BNB/USDT" },
  { base: "ARB", quote: "USDT", pair: "ARB/USDT" },
];

export const exchangeFees: Record<string, number> = {
  binance: 0.001,
  coinbase: 0.006,
  bybit: 0.001,
  okx: 0.001,
  kraken: 0.0026,
  kucoin: 0.001,
  gate: 0.002,
  mexc: 0.001,
};

async function loadExchangeFees() {
  const exchangeIds = ["binance", "coinbasepro", "bybit", "okx", "kraken", "kucoin"] as const;
  const nameMap: Record<string, string> = {
    binance: "binance",
    coinbasepro: "coinbase",
    bybit: "bybit",
    okx: "okx",
    kraken: "kraken",
    kucoin: "kucoin",
  };

  await Promise.allSettled(
    exchangeIds.map(async (id) => {
      try {
        const ExClass = (ccxt as Record<string, unknown>)[id] as (new () => ccxt.Exchange) | undefined;
        if (!ExClass) return;
        const exchange = new ExClass();
        exchange.options = { ...exchange.options, fetchResponse: false };

        await exchange.loadMarkets();
        const symbol = "BTC/USDT";
        let fee = 0.001;
        if (exchange.markets?.[symbol]?.taker != null) {
          fee = exchange.markets[symbol].taker ?? 0.001;
        } else {
          const feeInfo = await exchange.fetchTradingFee(symbol).catch(() => null);
          if (feeInfo?.taker != null) fee = feeInfo.taker;
        }
        const venueName = nameMap[id] ?? id;
        exchangeFees[venueName] = fee;
        logger.info({ exchange: venueName, fee }, "Loaded exchange fee");
      } catch (err) {
        logger.warn({ exchange: id, err }, "Failed to load exchange fee (using default)");
      }
    })
  );
}

function normalizePair(rawSymbol: string): { pair: string; base: string; quote: string } | null {
  const s = rawSymbol.toUpperCase().replace(/-/g, "").replace(/_/g, "");
  const stables = ["USDT", "USDC", "USD", "BUSD", "DAI"];
  for (const quote of stables) {
    if (s.endsWith(quote)) {
      const base = s.slice(0, s.length - quote.length);
      if (!MONITORED_PAIRS.some((p) => p.base === base)) return null;
      return { pair: `${base}/USDT`, base, quote: "USDT" };
    }
  }
  return null;
}

function handleTicker(venue: string, ticker: ccxws.Ticker) {
  try {
    const normalized = normalizePair(ticker.base + ticker.quote);
    if (!normalized) return;

    const price = parseFloat(String(ticker.last ?? 0));
    if (!price || isNaN(price)) return;

    priceStore.set({
      source: "cex",
      venue,
      chain: null,
      pair: normalized.pair,
      baseToken: normalized.base,
      quoteToken: normalized.quote,
      price,
      volume24h: ticker.quoteVolume != null ? parseFloat(String(ticker.quoteVolume)) : undefined,
      bid: ticker.bid != null ? parseFloat(String(ticker.bid)) : undefined,
      ask: ticker.ask != null ? parseFloat(String(ticker.ask)) : undefined,
      updatedAt: new Date(),
    });

    broadcast("price_update", {
      source: "cex",
      venue,
      pair: normalized.pair,
      price: ticker.last ?? 0,
    });
  } catch (err) {
    logger.error({ err, venue }, "Ticker handler error");
  }
}

function connectCcxwsExchange(
  ClientClass: new () => ccxws.BasicClient,
  venue: string,
  pairs: Array<{ base: string; quote: string; pair: string }>
) {
  let client: ccxws.BasicClient | null = null;

  function connect() {
    try {
      client = new ClientClass();

      client.on("ticker", (ticker: ccxws.Ticker) => handleTicker(venue, ticker));

      client.on("error", (err: Error) => {
        logger.error({ err, venue }, `${venue} WebSocket error`);
      });

      for (const p of pairs) {
        try {
          (client as ccxws.BasicClient).subscribeTicker({ id: `${p.base}-${p.quote}`, base: p.base, quote: p.quote, type: "spot" });
        } catch (e) {
          logger.warn({ venue, pair: p.pair, err: e }, "Failed to subscribe to ticker");
        }
      }

      logger.info({ venue }, `${venue} ccxws connected`);
    } catch (err) {
      logger.error({ err, venue }, `Failed to connect ${venue} ccxws, retrying in 10s`);
      setTimeout(connect, 10000);
    }
  }

  connect();
}

const MONITORED_PAIRS_BYBIT = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT", "UNIUSDT", "AAVEUSDT", "BNBUSDT", "ARBUSDT",
];

function connectBybit() {
  const ws = new WebSocket("wss://stream.bybit.com/v5/public/spot");

  ws.on("open", () => {
    logger.info("Bybit WebSocket connected");
    const subscribe = {
      op: "subscribe",
      args: MONITORED_PAIRS_BYBIT.map((p) => `tickers.${p}`),
    };
    ws.send(JSON.stringify(subscribe));
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg.data || !msg.topic) return;

      const data = msg.data;
      if (!data.symbol) return;

      const normalized = normalizePair(data.symbol);
      if (!normalized) return;

      priceStore.set({
        source: "cex",
        venue: "bybit",
        chain: null,
        pair: normalized.pair,
        baseToken: normalized.base,
        quoteToken: normalized.quote,
        price: parseFloat(data.lastPrice),
        volume24h: parseFloat(data.turnover24h),
        bid: parseFloat(data.bid1Price),
        ask: parseFloat(data.ask1Price),
        updatedAt: new Date(),
      });

      broadcast("price_update", {
        source: "cex",
        venue: "bybit",
        pair: normalized.pair,
        price: parseFloat(data.lastPrice),
      });
    } catch (err) {
      logger.error({ err }, "Bybit message parse error");
    }
  });

  ws.on("error", (err) => logger.error({ err }, "Bybit WebSocket error"));
  ws.on("close", () => {
    logger.warn("Bybit WebSocket closed, reconnecting in 5s");
    setTimeout(connectBybit, 5000);
  });
}

export function startCexIngestion() {
  logger.info("Starting CEX data ingestion via ccxws...");

  loadExchangeFees().catch((err) => logger.error({ err }, "Failed to load exchange fees"));

  const pairsForExchange = MONITORED_PAIRS.filter((p) =>
    ["BTC", "ETH", "SOL", "LINK", "UNI", "AAVE"].includes(p.base)
  );

  connectCcxwsExchange(ccxws.BinanceClient as unknown as new () => ccxws.BasicClient, "binance", pairsForExchange);
  connectCcxwsExchange(ccxws.CoinbaseProClient as unknown as new () => ccxws.BasicClient, "coinbase", pairsForExchange.filter(p => p.quote === "USDT").map(p => ({ ...p, quote: "USD" })));
  connectCcxwsExchange(ccxws.OkexClient as unknown as new () => ccxws.BasicClient, "okx", pairsForExchange);
  connectCcxwsExchange(ccxws.KrakenClient as unknown as new () => ccxws.BasicClient, "kraken", pairsForExchange);
  connectCcxwsExchange(ccxws.KucoinClient as unknown as new () => ccxws.BasicClient, "kucoin", pairsForExchange);

  connectBybit();
}
