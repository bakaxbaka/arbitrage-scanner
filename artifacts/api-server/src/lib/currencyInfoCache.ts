/**
 * Currency Info Cache
 *
 * Three data sources, each serving a different role:
 *
 *   Gate.io  — per-symbol withdraw/deposit enabled flags (4,000+ currencies)
 *   KuCoin   — per-chain contract address + withdraw/deposit per chain
 *   CoinGecko — canonical symbol → contract registry for mismatch detection
 *
 * "Ambiguous" symbols: a CoinGecko symbol that maps to >1 distinct token.
 *   e.g. "ELON" is both Dogelon Mars and multiple other ELON-named tokens.
 *   For ambiguous symbols where NEITHER exchange provides contract data we
 *   cannot verify it's the same token → treat as a mismatch.
 */

import { logger } from "./logger";

const FETCH_TIMEOUT_MS = 25_000;
const CEX_REFRESH_MS   = 30 * 60 * 1_000;  // 30 min
const CG_REFRESH_MS    = 24 * 60 * 60 * 1_000; // 24 h

// ─── CEX currency store ───────────────────────────────────────────────────────

interface ChainInfo {
  chain: string;
  contractAddress: string | undefined;
  isWithdrawEnabled: boolean;
  isDepositEnabled: boolean;
}

interface CurrencyInfo {
  withdrawEnabled: boolean;
  depositEnabled: boolean;
  chains: ChainInfo[];
}

// venue → SYMBOL → info
const cexCache = new Map<string, Map<string, CurrencyInfo>>();

function normalizeChain(chain: string): string {
  const n = chain.toLowerCase().replace(/\s+/g, "");
  if (n.includes("eth") || n === "erc20") return "ethereum";
  if (n.includes("bsc") || n.includes("bnb") || n === "bep20") return "bsc";
  if (n.includes("tron") || n === "trc20") return "tron";
  if (n.includes("sol")) return "solana";
  if (n.includes("avax") || n.includes("avalanche")) return "avalanche";
  if (n.includes("polygon") || n === "matic") return "polygon";
  if (n.includes("arb")) return "arbitrum";
  if (n.startsWith("base")) return "base";
  if (n.includes("optimism") || n.includes("opmainnet")) return "optimism";
  return n;
}

async function fetchGateCurrencies(): Promise<void> {
  const resp = await fetch("https://api.gateio.ws/api/v4/spot/currencies", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Gate.io currencies HTTP ${resp.status}`);

  const data = (await resp.json()) as Array<{
    currency: string;
    withdraw_disabled: boolean;
    deposit_disabled: boolean;
    delisted?: boolean;
  }>;

  const map = new Map<string, CurrencyInfo>();
  for (const item of data) {
    map.set(item.currency.toUpperCase(), {
      withdrawEnabled: !item.withdraw_disabled,
      depositEnabled: !item.deposit_disabled,
      chains: [],
    });
  }
  cexCache.set("gate", map);
  logger.info({ count: map.size }, "Currency cache: Gate.io loaded");
}

async function fetchKucoinCurrencies(): Promise<void> {
  const resp = await fetch("https://api.kucoin.com/api/v2/currencies", {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`KuCoin currencies HTTP ${resp.status}`);

  const body = (await resp.json()) as {
    data: Array<{
      currency: string;
      chains?: Array<{
        chainName: string;
        contractAddress?: string;
        isWithdrawEnabled: boolean;
        isDepositEnabled: boolean;
      }>;
    }>;
  };

  const map = new Map<string, CurrencyInfo>();
  for (const item of body.data ?? []) {
    const chains: ChainInfo[] = (item.chains ?? []).map((c) => ({
      chain: normalizeChain(c.chainName),
      contractAddress: c.contractAddress?.toLowerCase() || undefined,
      isWithdrawEnabled: c.isWithdrawEnabled,
      isDepositEnabled: c.isDepositEnabled,
    }));

    map.set(item.currency.toUpperCase(), {
      withdrawEnabled: chains.some((c) => c.isWithdrawEnabled),
      depositEnabled: chains.some((c) => c.isDepositEnabled),
      chains,
    });
  }
  cexCache.set("kucoin", map);
  logger.info({ count: map.size }, "Currency cache: KuCoin loaded");
}

// ─── CoinGecko symbol registry ────────────────────────────────────────────────

// SYMBOL → all contract addresses across every CG coin that shares this symbol
const cgAddressSet = new Map<string, Set<string>>();
// SYMBOL → count of distinct CoinGecko coins — >1 means "ambiguous"
const cgCoinCount  = new Map<string, number>();
// contract address (lowercase) → CoinGecko coin ID
const cgAddrToId   = new Map<string, string>();

let cgLoaded = false;

async function fetchCoinGeckoRegistry(): Promise<void> {
  const resp = await fetch(
    "https://api.coingecko.com/api/v3/coins/list?include_platform=true",
    { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
  );
  if (!resp.ok) throw new Error(`CoinGecko coins/list HTTP ${resp.status}`);

  const coins = (await resp.json()) as Array<{
    id: string;
    symbol: string;
    platforms?: Record<string, string>;
  }>;

  cgAddressSet.clear();
  cgCoinCount.clear();
  cgAddrToId.clear();

  for (const coin of coins) {
    const sym = coin.symbol.toUpperCase();

    // coin count per symbol
    cgCoinCount.set(sym, (cgCoinCount.get(sym) ?? 0) + 1);

    // address registry
    for (const [, addr] of Object.entries(coin.platforms ?? {})) {
      if (!addr) continue;
      const a = addr.toLowerCase();
      cgAddrToId.set(a, coin.id);
      if (!cgAddressSet.has(sym)) cgAddressSet.set(sym, new Set());
      cgAddressSet.get(sym)!.add(a);
    }
  }

  const ambiguous = [...cgCoinCount.values()].filter((c) => c > 1).length;
  cgLoaded = true;
  logger.info(
    { total: cgCoinCount.size, ambiguous, addresses: cgAddrToId.size },
    "Currency cache: CoinGecko registry loaded"
  );
}

// ─── Refresh scheduling ───────────────────────────────────────────────────────

async function refreshCex(): Promise<void> {
  await Promise.allSettled([fetchGateCurrencies(), fetchKucoinCurrencies()]);
}

async function refreshCg(): Promise<void> {
  try {
    await fetchCoinGeckoRegistry();
  } catch (err) {
    logger.warn({ err }, "CoinGecko registry fetch failed (non-fatal)");
  }
}

export async function startCurrencyInfoCache(): Promise<void> {
  // CEX data is needed before the arbitrage engine starts — await it.
  await refreshCex();

  // CoinGecko is best-effort and large — load in background after startup.
  refreshCg().catch((err) =>
    logger.warn({ err }, "CoinGecko initial load failed")
  );

  setInterval(() => {
    refreshCex().catch((err) =>
      logger.error({ err }, "CEX currency refresh failed")
    );
  }, CEX_REFRESH_MS);

  setInterval(() => {
    refreshCg().catch((err) =>
      logger.warn({ err }, "CoinGecko registry refresh failed")
    );
  }, CG_REFRESH_MS);
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

function getCexInfo(venue: string, symbol: string): CurrencyInfo | undefined {
  return cexCache.get(venue)?.get(symbol.toUpperCase());
}

/** True if withdrawal is confirmed disabled on this venue for this symbol. */
export function isWithdrawBlocked(venue: string, symbol: string): boolean {
  const info = getCexInfo(venue, symbol);
  if (!info) return false;
  return !info.withdrawEnabled;
}

/** True if deposit is confirmed disabled on this venue for this symbol. */
export function isDepositBlocked(venue: string, symbol: string): boolean {
  const info = getCexInfo(venue, symbol);
  if (!info) return false;
  return !info.depositEnabled;
}

/**
 * True when this symbol is known on CoinGecko to belong to multiple
 * distinct tokens — meaning a same-ticker listing on two exchanges could
 * easily be two completely different coins.
 */
export function isSymbolAmbiguous(symbol: string): boolean {
  if (!cgLoaded) return false;
  return (cgCoinCount.get(symbol.toUpperCase()) ?? 0) > 1;
}

/**
 * Returns true when we can confirm the pair is a ticker collision.
 *
 * Three ways to confirm:
 *  A) Both venues expose a contract on the same chain and they differ.
 *  B) One venue's contract address is not present in CoinGecko's registry
 *     for this symbol at all — meaning the exchange lists a completely
 *     different token version that CoinGecko doesn't associate with this symbol.
 *  C) The symbol is CoinGecko-ambiguous AND neither venue provides any
 *     contract address data — we can't verify they're the same token.
 */
export function hasContractMismatch(
  symbol: string,
  venue1: string,
  venue2: string
): boolean {
  const sym = symbol.toUpperCase();
  const info1 = getCexInfo(venue1, sym);
  const info2 = getCexInfo(venue2, sym);

  const addrs1 = buildAddrMap(info1);
  const addrs2 = buildAddrMap(info2);

  // ── Rule A: shared chain, different contract ──────────────────────────────
  for (const [chain, a1] of addrs1) {
    const a2 = addrs2.get(chain);
    if (a2 && a1 !== a2) {
      logger.debug({ symbol, venue1, venue2, chain, a1, a2 }, "Contract mismatch (Rule A)");
      return true;
    }
  }

  // ── Rule B: one side's contract not in CoinGecko's symbol registry ────────
  if (cgLoaded) {
    const cgSet = cgAddressSet.get(sym);
    if (cgSet && cgSet.size > 0) {
      for (const [, addr] of [...addrs1, ...addrs2]) {
        if (!cgSet.has(addr)) {
          logger.debug({ symbol, venue1, venue2, addr }, "Contract not in CoinGecko registry (Rule B)");
          return true;
        }
      }
    }

    // ── Rule C: ambiguous symbol, no contract data on either side ─────────────
    if (
      (cgCoinCount.get(sym) ?? 0) > 1 &&
      addrs1.size === 0 &&
      addrs2.size === 0
    ) {
      logger.debug({ symbol, venue1, venue2 }, "Ambiguous symbol, no contract data (Rule C)");
      return true;
    }
  }

  return false;
}

function buildAddrMap(info: CurrencyInfo | undefined): Map<string, string> {
  const m = new Map<string, string>();
  if (!info) return m;
  for (const c of info.chains) {
    if (c.contractAddress) m.set(c.chain, c.contractAddress);
  }
  return m;
}

/**
 * Returns a map of symbol → contract address for all KuCoin-listed tokens
 * that have a contract on the given normalized chain name (e.g. "ethereum",
 * "bsc", "arbitrum", "polygon", "base", "optimism", "avalanche").
 *
 * Used by the DEX pool scanner to batch-query DexScreener without depending
 * on CoinGecko's rate-limited API.
 */
export function getContractsByChain(chain: string): Map<string, string> {
  const result = new Map<string, string>();
  const kuMap = cexCache.get("kucoin");
  if (!kuMap) return result;
  for (const [symbol, info] of kuMap) {
    for (const c of info.chains) {
      if (c.chain === chain && c.contractAddress) {
        result.set(symbol.toUpperCase(), c.contractAddress.toLowerCase());
        break;
      }
    }
  }
  return result;
}
