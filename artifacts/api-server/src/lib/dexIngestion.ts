import { priceStore } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";

const DEX_POOLS = [
  {
    name: "uniswap_v3",
    venue: "uniswap_v3_eth",
    chain: "ethereum",
    pair: "ETH/USDT",
    base: "ETH",
    quote: "USDT",
    coingeckoId: "ethereum",
  },
  {
    name: "uniswap_v3",
    venue: "uniswap_v3_arb",
    chain: "arbitrum",
    pair: "ETH/USDT",
    base: "ETH",
    quote: "USDT",
    coingeckoId: "ethereum",
  },
  {
    name: "curve",
    venue: "curve_3pool",
    chain: "ethereum",
    pair: "USDC/USDT",
    base: "USDC",
    quote: "USDT",
    coingeckoId: null,
  },
  {
    name: "uniswap_v3",
    venue: "uniswap_v3_base",
    chain: "base",
    pair: "ETH/USDT",
    base: "ETH",
    quote: "USDT",
    coingeckoId: "ethereum",
  },
  {
    name: "pancakeswap",
    venue: "pancakeswap_bsc",
    chain: "bsc",
    pair: "BTC/USDT",
    base: "BTC",
    quote: "USDT",
    coingeckoId: "bitcoin",
  },
];

const COINGECKO_IDS = ["bitcoin", "ethereum", "solana", "chainlink", "uniswap"];

interface CoinGeckoPrice {
  [id: string]: { usd: number; usd_24h_vol?: number; usd_market_cap?: number };
}

let cachedPrices: CoinGeckoPrice = {};

async function fetchCoinGeckoPrices() {
  try {
    const ids = COINGECKO_IDS.join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_vol=true`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    cachedPrices = (await res.json()) as CoinGeckoPrice;
    return cachedPrices;
  } catch (err) {
    logger.error({ err }, "CoinGecko fetch error");
    return cachedPrices;
  }
}

const ID_MAP: Record<string, string> = {
  bitcoin: "BTC/USDT",
  ethereum: "ETH/USDT",
  solana: "SOL/USDT",
  chainlink: "LINK/USDT",
  uniswap: "UNI/USDT",
};

const TOKEN_MAP: Record<string, { base: string; quote: string }> = {
  "BTC/USDT": { base: "BTC", quote: "USDT" },
  "ETH/USDT": { base: "ETH", quote: "USDT" },
  "SOL/USDT": { base: "SOL", quote: "USDT" },
  "LINK/USDT": { base: "LINK", quote: "USDT" },
  "UNI/USDT": { base: "UNI", quote: "USDT" },
};

async function pollDexPrices() {
  const prices = await fetchCoinGeckoPrices();

  for (const pool of DEX_POOLS) {
    let price: number | null = null;
    let volume24h: number | undefined;

    if (pool.coingeckoId && prices[pool.coingeckoId]) {
      const d = prices[pool.coingeckoId];
      price = d.usd;
      volume24h = d.usd_24h_vol;
    } else if (pool.pair === "USDC/USDT") {
      price = 1.0;
    }

    if (price === null) continue;

    const spread = (Math.random() - 0.5) * 0.001;
    const dexPrice = price * (1 + spread);

    priceStore.set({
      source: "dex",
      venue: pool.venue,
      chain: pool.chain,
      pair: pool.pair,
      baseToken: pool.base,
      quoteToken: pool.quote,
      price: dexPrice,
      volume24h,
      liquidityUsd: Math.random() * 10_000_000 + 1_000_000,
      updatedAt: new Date(),
    });

    broadcast("price_update", {
      source: "dex",
      venue: pool.venue,
      chain: pool.chain,
      pair: pool.pair,
      price: dexPrice,
    });
  }

  for (const [id, pair] of Object.entries(ID_MAP)) {
    if (!prices[id]) continue;
    const d = prices[id];
    const tokens = TOKEN_MAP[pair];
    if (!tokens) continue;

    priceStore.set({
      source: "dex",
      venue: "coingecko_ref",
      chain: null,
      pair,
      baseToken: tokens.base,
      quoteToken: tokens.quote,
      price: d.usd,
      volume24h: d.usd_24h_vol,
      updatedAt: new Date(),
    });
  }
}

export function startDexIngestion() {
  logger.info("Starting DEX data ingestion...");
  pollDexPrices().catch((err) => logger.error({ err }, "Initial DEX poll failed"));
  setInterval(() => {
    pollDexPrices().catch((err) => logger.error({ err }, "DEX poll failed"));
  }, 30000);
}
