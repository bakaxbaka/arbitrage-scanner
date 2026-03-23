/**
 * DEX Pool Scanner
 *
 * Uses KuCoin contract addresses (from currencyInfoCache) to query DexScreener
 * for live DEX pool prices across all major EVM chains — no CoinGecko rate
 * limits, no startup delay beyond the initial KuCoin currency cache load (~15s).
 *
 * For each token symbol, picks the highest-liquidity stablecoin-quoted pool
 * on each chain and stores it in the priceStore as TOKEN/USDT with realistic
 * bid/ask spread (pool fee baked in), enabling DEX↔CEX arbitrage detection.
 *
 * Polls every 60 s after a 35 s warm-up delay (KuCoin currency data loads in ~15s,
 * but we wait a bit longer to make sure the cache is fully populated).
 */

import { priceStore } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";
import { getContractsByChain } from "./currencyInfoCache";

const DEXSCREENER_BASE = "https://api.dexscreener.com";
const POLL_INTERVAL_MS = 60_000;
const WARMUP_DELAY_MS  = 35_000;
const BATCH_SIZE = 30;
const MIN_LIQUIDITY_USD = 10_000;

const CHAIN_DEXSCREENER_ID: Record<string, string> = {
  ethereum: "ethereum",
  bsc:      "bsc",
  polygon:  "polygon",
  arbitrum: "arbitrum",
  base:     "base",
  optimism: "optimism",
  avalanche: "avalanche",
};

const DEX_POOL_FEE = 0.003;

const STABLE_QUOTES = new Set(["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD"]);

interface DsPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string };
  quoteToken: { symbol: string };
  priceUsd: string | null;
  volume?: { h24?: number };
  liquidity?: { usd?: number };
}

function formatVenue(dexId: string, chain: string): string {
  const chainLabel = chain.charAt(0).toUpperCase() + chain.slice(1);
  const id = dexId.toLowerCase();
  const dex =
    id.includes("uniswap")   ? "Uniswap"      :
    id.includes("pancake")   ? "PancakeSwap"  :
    id.includes("sushi")     ? "SushiSwap"    :
    id.includes("curve")     ? "Curve"        :
    id.includes("camelot")   ? "Camelot"      :
    id.includes("aerodrome") ? "Aerodrome"    :
    id.includes("velodrome") ? "Velodrome"    :
    id.includes("trader")    ? "TraderJoe"    :
    id.includes("quickswap") ? "QuickSwap"    :
    id.includes("balancer")  ? "Balancer"     :
    dexId.charAt(0).toUpperCase() + dexId.slice(1);
  return `${dex} / ${chainLabel}`;
}

async function fetchDexScreenerTokens(chain: string, addresses: string[]): Promise<DsPair[]> {
  const batch = addresses.slice(0, BATCH_SIZE).join(",");
  const url = `${DEXSCREENER_BASE}/tokens/v1/${chain}/${batch}`;

  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as DsPair[] | { pairs: DsPair[] | null };
    if (Array.isArray(data)) return data;
    if (data && "pairs" in data && Array.isArray(data.pairs)) return data.pairs;
    return [];
  } catch {
    return [];
  }
}

function pickBestPool(pairs: DsPair[]): DsPair | null {
  const stable = pairs.filter((p) => STABLE_QUOTES.has(p.quoteToken.symbol));
  const pool   = stable.length > 0 ? stable : pairs;
  const withPrice = pool.filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0);
  if (!withPrice.length) return null;
  return withPrice.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}

async function scanChain(normalizedChain: string, dexChainId: string): Promise<number> {
  const contractsBySymbol = getContractsByChain(normalizedChain);
  if (contractsBySymbol.size === 0) return 0;

  const addrToSymbol = new Map<string, string>();
  for (const [symbol, addr] of contractsBySymbol) {
    addrToSymbol.set(addr, symbol);
  }

  const addresses = [...addrToSymbol.keys()];
  const batches: string[][] = [];
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    batches.push(addresses.slice(i, i + BATCH_SIZE));
  }

  let updated = 0;

  for (const batch of batches) {
    const pairs = await fetchDexScreenerTokens(dexChainId, batch);

    const pairsByBase = new Map<string, DsPair[]>();
    for (const pair of pairs) {
      const addr = pair.baseToken.address.toLowerCase();
      if (!pairsByBase.has(addr)) pairsByBase.set(addr, []);
      pairsByBase.get(addr)!.push(pair);
    }

    for (const addr of batch) {
      const symbol = addrToSymbol.get(addr);
      if (!symbol) continue;

      const tokenPairs = pairsByBase.get(addr) ?? [];
      const best = pickBestPool(tokenPairs);
      if (!best?.priceUsd) continue;

      const price = parseFloat(best.priceUsd);
      if (isNaN(price) || price <= 0) continue;
      if ((best.liquidity?.usd ?? 0) < MIN_LIQUIDITY_USD) continue;

      const pairKey = `${symbol}/USDT`;
      const venue   = formatVenue(best.dexId, dexChainId);

      priceStore.set({
        source:      "dex",
        venue,
        chain:       dexChainId,
        pair:        pairKey,
        baseToken:   symbol,
        quoteToken:  "USDT",
        price,
        bid:         price * (1 - DEX_POOL_FEE),
        ask:         price * (1 + DEX_POOL_FEE),
        volume24h:   best.volume?.h24,
        liquidityUsd: best.liquidity?.usd,
        updatedAt:   new Date(),
      });

      broadcast("price_update", {
        source: "dex",
        venue,
        chain:  dexChainId,
        pair:   pairKey,
        price,
      });

      updated++;
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  return updated;
}

async function runScan(): Promise<void> {
  let totalUpdated = 0;

  for (const [normalizedChain, dexChainId] of Object.entries(CHAIN_DEXSCREENER_ID)) {
    try {
      const updated = await scanChain(normalizedChain, dexChainId);
      totalUpdated += updated;
    } catch (err) {
      logger.warn({ err, chain: dexChainId }, "DEX pool scan error for chain");
    }
  }

  if (totalUpdated > 0) {
    logger.info({ updated: totalUpdated }, "DEX pool scan complete");
  }
}

export function startDexPoolScanner(): void {
  logger.info("Starting DEX pool scanner (KuCoin contracts → DexScreener)...");

  setTimeout(() => {
    runScan().catch((err) => logger.warn({ err }, "DEX pool initial scan failed"));
    setInterval(() => {
      runScan().catch((err) => logger.warn({ err }, "DEX pool scan failed"));
    }, POLL_INTERVAL_MS);
  }, WARMUP_DELAY_MS);
}
