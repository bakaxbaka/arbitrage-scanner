import { priceStore } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const DEXSCREENER_BASE = "https://api.dexscreener.com";

const EVM_CHAINS = [
  "ethereum",
  "arbitrum-one",
  "base",
  "binance-smart-chain",
  "polygon-pos",
  "optimistic-ethereum",
  "avalanche",
] as const;

const CHAIN_ID_MAP: Record<string, string> = {
  "ethereum": "ethereum",
  "arbitrum-one": "arbitrum",
  "base": "base",
  "binance-smart-chain": "bsc",
  "polygon-pos": "polygon",
  "optimistic-ethereum": "optimism",
  "avalanche": "avalanche",
};

const GAS_COSTS_USD: Record<string, number> = {
  ethereum: 20,
  arbitrum: 0.5,
  base: 0.1,
  bsc: 0.2,
  polygon: 0.05,
  optimism: 0.2,
  avalanche: 0.5,
};

interface CoinMarket {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
}

interface CoinPlatform {
  id: string;
  symbol: string;
  platforms: Record<string, string>;
}

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  priceUsd: string | null;
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

interface TokenInfo {
  coingeckoId: string;
  symbol: string;
  name: string;
  marketCap: number;
  addresses: Record<string, string>;
}

let topTokensCache: TokenInfo[] = [];
let lastTokenRefresh = 0;
const TOKEN_REFRESH_INTERVAL = 30 * 60 * 1000;

function formatDexVenue(dexId: string, chain: string): string {
  const chainLabel = chain.charAt(0).toUpperCase() + chain.slice(1);
  const id = dexId.toLowerCase();
  const dex =
    id.includes("uniswap") ? "Uniswap" :
    id.includes("pancake") ? "PancakeSwap" :
    id.includes("sushi") ? "SushiSwap" :
    id.includes("curve") ? "Curve" :
    id.includes("camelot") ? "Camelot" :
    id.includes("aerodrome") ? "Aerodrome" :
    id.includes("velodrome") ? "Velodrome" :
    id.includes("trader") ? "TraderJoe" :
    id.includes("orca") ? "Orca" :
    dexId.charAt(0).toUpperCase() + dexId.slice(1);
  return `${dex} / ${chainLabel}`;
}

let platformCache: CoinPlatform[] = [];
let lastPlatformRefresh = 0;
const PLATFORM_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url: string, retries = 3, delayMs = 2000): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        const wait = delayMs * Math.pow(2, attempt);
        logger.warn({ url, wait }, "Rate limited, backing off");
        await sleep(wait);
        continue;
      }
      return res;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(delayMs * Math.pow(2, attempt));
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

async function fetchTopMarkets(page: number): Promise<CoinMarket[]> {
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`CoinGecko markets HTTP ${res.status}`);
  return res.json() as Promise<CoinMarket[]>;
}

async function fetchAllPlatforms(): Promise<CoinPlatform[]> {
  const url = `${COINGECKO_BASE}/coins/list?include_platform=true`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`CoinGecko list HTTP ${res.status}`);
  return res.json() as Promise<CoinPlatform[]>;
}

async function refreshTopTokens(): Promise<void> {
  const now = Date.now();
  if (now - lastTokenRefresh < TOKEN_REFRESH_INTERVAL && topTokensCache.length > 0) return;

  logger.info("Refreshing top coin list from CoinGecko...");

  if (now - lastPlatformRefresh > PLATFORM_REFRESH_INTERVAL || platformCache.length === 0) {
    logger.info("Fetching coin platform addresses from CoinGecko...");
    platformCache = await fetchAllPlatforms();
    lastPlatformRefresh = Date.now();
    await sleep(15_000);
  }

  const markets1 = await fetchTopMarkets(1);
  await sleep(15_000);
  const markets2 = await fetchTopMarkets(2);
  await sleep(15_000);
  const markets3 = await fetchTopMarkets(3);
  await sleep(15_000);
  const markets4 = await fetchTopMarkets(4);

  const allMarkets = [...markets1, ...markets2, ...markets3, ...markets4];
  const platformMap = new Map(platformCache.map((c) => [c.id, c.platforms]));

  const tokens: TokenInfo[] = [];

  for (const coin of allMarkets) {
    if (!coin.current_price || coin.current_price <= 0) continue;
    const platforms = platformMap.get(coin.id) ?? {};

    const evmAddresses: Record<string, string> = {};
    for (const chain of EVM_CHAINS) {
      const addr = platforms[chain];
      if (addr && addr.length > 0) {
        evmAddresses[chain] = addr.toLowerCase();
      }
    }

    if (Object.keys(evmAddresses).length === 0) continue;

    tokens.push({
      coingeckoId: coin.id,
      symbol: coin.symbol.toUpperCase(),
      name: coin.name,
      marketCap: coin.market_cap ?? 0,
      addresses: evmAddresses,
    });
  }

  topTokensCache = tokens;
  lastTokenRefresh = now;
  logger.info({ count: tokens.length }, "Token list refreshed — EVM-addressable coins in top 1000");
}

async function queryDexScreenerTokens(
  chainId: string,
  addresses: string[]
): Promise<DexScreenerPair[]> {
  const batch = addresses.slice(0, 30).join(",");
  const url = `${DEXSCREENER_BASE}/tokens/v1/${chainId}/${batch}`;

  try {
    const res = await fetchWithRetry(url, 2, 1000);
    if (!res.ok) return [];
    const data = (await res.json()) as DexScreenerResponse | DexScreenerPair[];

    if (Array.isArray(data)) return data as DexScreenerPair[];
    if (data && "pairs" in data && Array.isArray(data.pairs)) return data.pairs;
    return [];
  } catch (err) {
    logger.debug({ err, chainId, count: addresses.length }, "DexScreener fetch error");
    return [];
  }
}

function pickBestPair(pairs: DexScreenerPair[]): DexScreenerPair | null {
  const stableQuotes = new Set(["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD"]);

  const stablyQuoted = pairs.filter((p) => stableQuotes.has(p.quoteToken.symbol));
  const pool = stablyQuoted.length > 0 ? stablyQuoted : pairs;

  const withPrice = pool.filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0);
  if (withPrice.length === 0) return null;

  return withPrice.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}

async function scanChain(coingeckoChainId: string, tokens: TokenInfo[]): Promise<void> {
  const dexChainId = CHAIN_ID_MAP[coingeckoChainId];
  if (!dexChainId) return;

  const eligible = tokens.filter((t) => t.addresses[coingeckoChainId]);
  if (eligible.length === 0) return;

  const addrToToken = new Map<string, TokenInfo>();
  for (const t of eligible) {
    addrToToken.set(t.addresses[coingeckoChainId]!, t);
  }

  const addresses = [...addrToToken.keys()];
  const BATCH_SIZE = 30;
  const batches: string[][] = [];

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    batches.push(addresses.slice(i, i + BATCH_SIZE));
  }

  let updated = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!;
    const pairs = await queryDexScreenerTokens(dexChainId, batch);

    const pairsByBase = new Map<string, DexScreenerPair[]>();
    for (const pair of pairs) {
      const addr = pair.baseToken.address.toLowerCase();
      if (!pairsByBase.has(addr)) pairsByBase.set(addr, []);
      pairsByBase.get(addr)!.push(pair);
    }

    for (const addr of batch) {
      const token = addrToToken.get(addr);
      if (!token) continue;

      const tokenPairs = pairsByBase.get(addr) ?? [];
      const best = pickBestPair(tokenPairs);
      if (!best || !best.priceUsd) continue;

      const priceUsd = parseFloat(best.priceUsd);
      if (isNaN(priceUsd) || priceUsd <= 0) continue;

      const pair = `${token.symbol}/USDT`;
      const venue = formatDexVenue(best.dexId, dexChainId);
      const poolFee = 0.003;

      priceStore.set({
        source: "dex",
        venue,
        chain: dexChainId,
        pair,
        baseToken: token.symbol,
        quoteToken: "USDT",
        price: priceUsd,
        bid: priceUsd * (1 - poolFee),
        ask: priceUsd * (1 + poolFee),
        volume24h: best.volume?.h24,
        liquidityUsd: best.liquidity?.usd,
        updatedAt: new Date(),
      });

      broadcast("price_update", {
        source: "dex",
        venue,
        chain: dexChainId,
        pair,
        price: priceUsd,
      });

      updated++;
    }

    if (b < batches.length - 1) {
      await sleep(300);
    }
  }

  if (updated > 0) {
    logger.info({ chain: dexChainId, updated }, "Chain scan complete");
  }
}

async function runScanCycle(): Promise<void> {
  try {
    await refreshTopTokens();

    if (topTokensCache.length === 0) {
      logger.warn("No tokens to scan");
      return;
    }

    logger.info({ chains: EVM_CHAINS.length, tokens: topTokensCache.length }, "Starting scan cycle");

    for (const chain of EVM_CHAINS) {
      await scanChain(chain, topTokensCache);
      await sleep(500);
    }

    logger.info("Scan cycle complete");
  } catch (err) {
    logger.error({ err }, "Chain scan cycle failed");
  }
}

export function startChainScanner(): void {
  logger.info("Starting multi-chain EVM scanner (top 1000 coins)...");

  runScanCycle().catch((err) => logger.error({ err }, "Initial chain scan failed"));

  setInterval(() => {
    runScanCycle().catch((err) => logger.error({ err }, "Chain scan failed"));
  }, 60_000);
}

export function getScannedTokenCount(): number {
  return topTokensCache.length;
}

export function getScannedChains(): string[] {
  return Object.values(CHAIN_ID_MAP);
}
