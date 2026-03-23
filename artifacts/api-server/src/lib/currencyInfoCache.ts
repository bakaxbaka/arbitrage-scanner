/**
 * Currency Info Cache
 *
 * Fetches and caches per-symbol metadata from Gate.io and KuCoin:
 *   - withdraw_enabled / deposit_enabled
 *   - contract address per chain (for cross-venue collision detection)
 *
 * Refreshes every 30 minutes. Defaults to "allowed / no data" so that
 * unknown tokens never get silently blocked.
 */

import { logger } from "./logger";

const FETCH_TIMEOUT_MS = 20_000;
const REFRESH_INTERVAL_MS = 30 * 60 * 1_000;

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

const cache = new Map<string, Map<string, CurrencyInfo>>();

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

  cache.set("gate", map);
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

  cache.set("kucoin", map);
  logger.info({ count: map.size }, "Currency cache: KuCoin loaded");
}

async function refresh(): Promise<void> {
  await Promise.allSettled([fetchGateCurrencies(), fetchKucoinCurrencies()]);
}

export async function startCurrencyInfoCache(): Promise<void> {
  await refresh();
  setInterval(() => {
    refresh().catch((err) =>
      logger.error({ err }, "Currency info cache refresh failed")
    );
  }, REFRESH_INTERVAL_MS);
}

function getInfo(venue: string, symbol: string): CurrencyInfo | undefined {
  return cache.get(venue)?.get(symbol.toUpperCase());
}

/** True if we know withdrawal is disabled on this venue for this symbol. */
export function isWithdrawBlocked(venue: string, symbol: string): boolean {
  const info = getInfo(venue, symbol);
  if (!info) return false;
  return !info.withdrawEnabled;
}

/** True if we know deposit is disabled on this venue for this symbol. */
export function isDepositBlocked(venue: string, symbol: string): boolean {
  const info = getInfo(venue, symbol);
  if (!info) return false;
  return !info.depositEnabled;
}

/**
 * Returns true when both venues have a known contract address on the same chain
 * and those addresses differ — a strong signal that the tickers represent
 * different underlying tokens.
 */
export function hasContractMismatch(
  symbol: string,
  venue1: string,
  venue2: string
): boolean {
  const info1 = getInfo(venue1, symbol);
  const info2 = getInfo(venue2, symbol);
  if (!info1?.chains.length || !info2?.chains.length) return false;

  const addrMap1 = new Map<string, string>();
  for (const c of info1.chains) {
    if (c.contractAddress) addrMap1.set(c.chain, c.contractAddress);
  }

  for (const c of info2.chains) {
    if (!c.contractAddress) continue;
    const a1 = addrMap1.get(c.chain);
    if (a1 && a1 !== c.contractAddress) {
      logger.debug(
        { symbol, venue1, venue2, chain: c.chain, a1, a2: c.contractAddress },
        "Contract address mismatch detected"
      );
      return true;
    }
  }

  return false;
}
