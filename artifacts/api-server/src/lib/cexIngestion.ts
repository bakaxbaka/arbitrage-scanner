import WebSocket from "ws";
import { priceStore } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";

const MONITORED_PAIRS_BINANCE = [
  "btcusdt", "ethusdt", "solusdt", "linkusdt", "uniusdt",
  "aaveusdt", "bnbusdt", "arbusdt",
];

const MONITORED_PAIRS_COINBASE: Record<string, string> = {
  "BTC-USD": "BTC/USDT",
  "ETH-USD": "ETH/USDT",
  "SOL-USD": "SOL/USDT",
  "LINK-USD": "LINK/USDT",
  "UNI-USD": "UNI/USDT",
};

const MONITORED_PAIRS_BYBIT = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "LINKUSDT",
];

const MONITORED_PAIRS_OKX = [
  "BTC-USDT", "ETH-USDT", "SOL-USDT", "LINK-USDT",
];

function normalizePair(rawSymbol: string): { pair: string; base: string; quote: string } | null {
  const s = rawSymbol.toUpperCase().replace("-", "").replace("_", "");
  const stables = ["USDT", "USDC", "USD", "BUSD", "DAI"];
  for (const quote of stables) {
    if (s.endsWith(quote)) {
      const base = s.slice(0, s.length - quote.length);
      return { pair: `${base}/USDT`, base, quote: "USDT" };
    }
  }
  return null;
}

function connectBinance() {
  const streams = MONITORED_PAIRS_BINANCE.map((p) => `${p}@ticker`).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  const ws = new WebSocket(url);

  ws.on("open", () => logger.info("Binance WebSocket connected"));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const data = msg.data || msg;
      if (!data || !data.s) return;

      const normalized = normalizePair(data.s);
      if (!normalized) return;

      priceStore.set({
        source: "cex",
        venue: "binance",
        chain: null,
        pair: normalized.pair,
        baseToken: normalized.base,
        quoteToken: normalized.quote,
        price: parseFloat(data.c),
        volume24h: parseFloat(data.v) * parseFloat(data.c),
        bid: parseFloat(data.b),
        ask: parseFloat(data.a),
        updatedAt: new Date(),
      });

      broadcast("price_update", {
        source: "cex",
        venue: "binance",
        pair: normalized.pair,
        price: parseFloat(data.c),
      });
    } catch (err) {
      logger.error({ err }, "Binance message parse error");
    }
  });

  ws.on("error", (err) => logger.error({ err }, "Binance WebSocket error"));
  ws.on("close", () => {
    logger.warn("Binance WebSocket closed, reconnecting in 5s");
    setTimeout(connectBinance, 5000);
  });
}

function connectCoinbase() {
  const ws = new WebSocket("wss://ws-feed.exchange.coinbase.com");

  ws.on("open", () => {
    logger.info("Coinbase WebSocket connected");
    const subscribe = {
      type: "subscribe",
      product_ids: Object.keys(MONITORED_PAIRS_COINBASE),
      channels: ["ticker"],
    };
    ws.send(JSON.stringify(subscribe));
  });

  ws.on("message", (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type !== "ticker") return;

      const mappedPair = MONITORED_PAIRS_COINBASE[data.product_id];
      if (!mappedPair) return;

      const base = mappedPair.split("/")[0];
      priceStore.set({
        source: "cex",
        venue: "coinbase",
        chain: null,
        pair: mappedPair,
        baseToken: base,
        quoteToken: "USDT",
        price: parseFloat(data.price),
        volume24h: parseFloat(data.volume_24h) * parseFloat(data.price),
        bid: parseFloat(data.best_bid),
        ask: parseFloat(data.best_ask),
        updatedAt: new Date(),
      });

      broadcast("price_update", {
        source: "cex",
        venue: "coinbase",
        pair: mappedPair,
        price: parseFloat(data.price),
      });
    } catch (err) {
      logger.error({ err }, "Coinbase message parse error");
    }
  });

  ws.on("error", (err) => logger.error({ err }, "Coinbase WebSocket error"));
  ws.on("close", () => {
    logger.warn("Coinbase WebSocket closed, reconnecting in 5s");
    setTimeout(connectCoinbase, 5000);
  });
}

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

function connectOKX() {
  const ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");

  ws.on("open", () => {
    logger.info("OKX WebSocket connected");
    const subscribe = {
      op: "subscribe",
      args: MONITORED_PAIRS_OKX.map((p) => ({ channel: "tickers", instId: p })),
    };
    ws.send(JSON.stringify(subscribe));
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (!msg.data || !Array.isArray(msg.data) || msg.data.length === 0) return;

      const data = msg.data[0];
      if (!data.instId) return;

      const normalized = normalizePair(data.instId);
      if (!normalized) return;

      priceStore.set({
        source: "cex",
        venue: "okx",
        chain: null,
        pair: normalized.pair,
        baseToken: normalized.base,
        quoteToken: normalized.quote,
        price: parseFloat(data.last),
        volume24h: parseFloat(data.volCcy24h),
        bid: parseFloat(data.bidPx),
        ask: parseFloat(data.askPx),
        updatedAt: new Date(),
      });

      broadcast("price_update", {
        source: "cex",
        venue: "okx",
        pair: normalized.pair,
        price: parseFloat(data.last),
      });
    } catch (err) {
      logger.error({ err }, "OKX message parse error");
    }
  });

  ws.on("error", (err) => logger.error({ err }, "OKX WebSocket error"));
  ws.on("close", () => {
    logger.warn("OKX WebSocket closed, reconnecting in 5s");
    setTimeout(connectOKX, 5000);
  });
}

export function startCexIngestion() {
  logger.info("Starting CEX data ingestion...");
  connectBinance();
  connectCoinbase();
  connectBybit();
  connectOKX();
}
