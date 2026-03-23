import { Router, type IRouter } from "express";
import { priceStore } from "../lib/priceStore";
import { broadcast } from "../lib/wsServer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEXSCREENER_BASE = "https://api.dexscreener.com";

const EVM_CHAIN_IDS = [
  "ethereum",
  "arbitrum",
  "base",
  "bsc",
  "polygon",
  "optimism",
  "avalanche",
  "zksync",
  "linea",
  "scroll",
] as const;

const STABLE_QUOTES = new Set(["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDE", "FRAX"]);

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string; name: string };
  priceUsd: string | null;
  priceNative: string | null;
  volume?: { h24?: number; h6?: number; h1?: number };
  liquidity?: { usd?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
}

interface DexScreenerTokenResponse {
  pairs: DexScreenerPair[] | null;
}

async function queryDexScreenerForAddress(
  chainId: string,
  address: string
): Promise<DexScreenerPair[]> {
  const url = `${DEXSCREENER_BASE}/tokens/v1/${chainId}/${address.toLowerCase()}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as DexScreenerTokenResponse | DexScreenerPair[];
    if (Array.isArray(data)) return data;
    if (data && "pairs" in data && Array.isArray(data.pairs)) return data.pairs;
    return [];
  } catch {
    return [];
  }
}

function pickBestPairs(pairs: DexScreenerPair[]): DexScreenerPair[] {
  const byChain = new Map<string, DexScreenerPair[]>();
  for (const p of pairs) {
    if (!byChain.has(p.chainId)) byChain.set(p.chainId, []);
    byChain.get(p.chainId)!.push(p);
  }

  const result: DexScreenerPair[] = [];
  for (const [, chainPairs] of byChain) {
    const stablyQuoted = chainPairs.filter((p) => STABLE_QUOTES.has(p.quoteToken.symbol));
    const pool = stablyQuoted.length > 0 ? stablyQuoted : chainPairs;
    const withPrice = pool.filter((p) => p.priceUsd && parseFloat(p.priceUsd) > 0);
    if (withPrice.length === 0) continue;
    const best = withPrice.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (best) result.push(best);
  }
  return result;
}

router.get("/v1/scan-contract", async (req, res) => {
  const address = (req.query["address"] as string ?? "").trim().toLowerCase();

  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    res.status(400).json({ error: "Invalid contract address. Must be 0x followed by 40 hex characters." });
    return;
  }

  logger.info({ address }, "Scanning contract address across all EVM chains");

  const chainResults = await Promise.allSettled(
    EVM_CHAIN_IDS.map((chain) => queryDexScreenerForAddress(chain, address))
  );

  const allPairs: DexScreenerPair[] = [];
  for (const result of chainResults) {
    if (result.status === "fulfilled") {
      allPairs.push(...result.value);
    }
  }

  if (allPairs.length === 0) {
    res.json({ found: false, prices: [], message: "No trading pairs found for this contract address." });
    return;
  }

  const bestPairs = pickBestPairs(allPairs);

  const prices: object[] = [];

  for (const pair of bestPairs) {
    const priceUsd = pair.priceUsd ? parseFloat(pair.priceUsd) : null;
    if (!priceUsd || isNaN(priceUsd) || priceUsd <= 0) continue;

    const symbol = pair.baseToken.symbol.toUpperCase();
    const pairName = `${symbol}/USD`;
    const venue = `${pair.dexId}_${pair.chainId}`;

    priceStore.set({
      source: "dex",
      venue,
      chain: pair.chainId,
      pair: pairName,
      baseToken: symbol,
      quoteToken: "USD",
      price: priceUsd,
      volume24h: pair.volume?.h24,
      liquidityUsd: pair.liquidity?.usd,
      updatedAt: new Date(),
    });

    broadcast("price_update", {
      source: "dex",
      venue,
      chain: pair.chainId,
      pair: pairName,
      price: priceUsd,
    });

    prices.push({
      chain: pair.chainId,
      dex: pair.dexId,
      venue,
      pair: pairName,
      symbol,
      name: pair.baseToken.name,
      address: pair.baseToken.address,
      pairAddress: pair.pairAddress,
      priceUsd,
      volume24h: pair.volume?.h24 ?? null,
      liquidityUsd: pair.liquidity?.usd ?? null,
      priceChange24h: pair.priceChange?.h24 ?? null,
      dexUrl: pair.url,
    });
  }

  logger.info({ address, chainsFound: prices.length }, "Contract scan complete");

  res.json({
    found: true,
    address,
    prices,
    chainsFound: prices.length,
    totalPairsFound: allPairs.length,
  });
});

export default router;
