import { logger } from "./logger";

export interface VenueResult {
  venue: string;
  venueType: "cex" | "dex";
  estimatedPrice: number;
  slippagePct: number;
  feePct: number;
  netProceeds: number;
  liquidityUsd?: number;
  gasEstimateUsd?: number;
  available: boolean;
  errorReason?: string;
}

export interface ScanResult {
  token: string;
  tokenSymbol: string;
  amount: number;
  results: VenueResult[];
  bestVenue: string | null;
  splitSuggestion: SplitSuggestion | null;
  thinLiquidityWarning: boolean;
  scannedAt: string;
}

export interface SplitSuggestion {
  venueA: string;
  venueASharePct: number;
  venueB: string;
  venueBSharePct: number;
  estimatedNetProceeds: number;
  improvementVsSingle: number;
}

const CEX_FEE: Record<string, number> = {
  binance: 0.001,
  mexc: 0.002,
  "gate.io": 0.002,
  kraken: 0.0026,
  okx: 0.001,
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveCoinGeckoToken(token: string): Promise<{ id: string; symbol: string; platforms: Record<string, string>; tickers: any[] } | null> {
  try {
    const isAddress = token.startsWith("0x") && token.length === 42;

    if (isAddress) {
      const url = `https://api.coingecko.com/api/v3/coins/ethereum/contract/${token}`;
      const res = await fetchWithTimeout(url);
      if (res.status === 429) throw new Error("RATE_LIMITED");
      if (!res.ok) return null;
      const data = await res.json() as any;
      return { id: data.id, symbol: data.symbol?.toUpperCase(), platforms: data.platforms || {}, tickers: data.tickers || [] };
    } else {
      const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(token)}`;
      const res = await fetchWithTimeout(url);
      if (res.status === 429) throw new Error("RATE_LIMITED");
      if (!res.ok) return null;
      const data = await res.json() as any;
      const coins: any[] = data.coins || [];
      const exact = coins.find((c: any) => c.symbol?.toLowerCase() === token.toLowerCase());
      const match = exact || coins[0];
      if (!match) return null;

      const detailUrl = `https://api.coingecko.com/api/v3/coins/${match.id}?localization=false&tickers=true&market_data=false`;
      const detailRes = await fetchWithTimeout(detailUrl);
      if (detailRes.status === 429) throw new Error("RATE_LIMITED");
      if (!detailRes.ok) return null;
      const detail = await detailRes.json() as any;
      return { id: detail.id, symbol: detail.symbol?.toUpperCase(), platforms: detail.platforms || {}, tickers: detail.tickers || [] };
    }
  } catch (err: any) {
    if (err?.message === "RATE_LIMITED") throw err;
    logger.error({ err }, "CoinGecko token resolve error");
    return null;
  }
}

function findCexSymbolFromTickers(tickers: any[], exchangeId: string): string | null {
  const exchangeMap: Record<string, string[]> = {
    binance: ["binance"],
    mexc: ["mxc", "mexc"],
    "gate.io": ["gate", "gateio"],
    kraken: ["kraken"],
    okx: ["okx", "okex"],
  };
  const ids = exchangeMap[exchangeId] || [exchangeId];
  for (const t of tickers) {
    const mktId = (t.market?.identifier || "").toLowerCase();
    if (ids.some((id: string) => mktId.includes(id))) {
      const base = (t.base || "").toUpperCase();
      const target = (t.target || "").toUpperCase();
      if (["USDT", "USD", "USDC"].includes(target)) {
        return base;
      }
    }
  }
  return null;
}

function walkBids(bids: [string, string][], amountTokens: number): { avgPrice: number; filled: number } | null {
  let remaining = amountTokens;
  let totalUsd = 0;
  let filled = 0;

  for (const [priceStr, sizeStr] of bids) {
    const price = parseFloat(priceStr);
    const size = parseFloat(sizeStr);
    if (isNaN(price) || isNaN(size) || size <= 0) continue;
    const take = Math.min(remaining, size);
    totalUsd += take * price;
    filled += take;
    remaining -= take;
    if (remaining <= 0) break;
  }

  if (filled === 0) return null;
  return { avgPrice: totalUsd / filled, filled };
}

function buildCexResult(venue: string, walk: { avgPrice: number; filled: number }, midPrice: number, feePct: number): VenueResult {
  const slippagePct = ((midPrice - walk.avgPrice) / midPrice) * 100;
  const netProceeds = walk.avgPrice * walk.filled * (1 - feePct);
  return {
    venue,
    venueType: "cex",
    estimatedPrice: walk.avgPrice,
    slippagePct: Math.max(0, slippagePct),
    feePct: feePct * 100,
    netProceeds,
    available: true,
  };
}

async function scanBinance(symbol: string, amount: number, tickers: any[]): Promise<VenueResult> {
  const cexSymbol = findCexSymbolFromTickers(tickers, "binance") || symbol;
  const pair = `${cexSymbol.toUpperCase()}USDT`;
  try {
    const url = `https://api.binance.com/api/v3/depth?symbol=${pair}&limit=100`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const data = await res.json() as any;
    const bids: [string, string][] = data.bids || [];
    const midPrice = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
    if (midPrice === 0) throw new Error("No bids");
    const walk = walkBids(bids, amount);
    if (!walk) throw new Error("Not enough liquidity");
    return buildCexResult("Binance", walk, midPrice, CEX_FEE.binance!);
  } catch (err: any) {
    return { venue: "Binance", venueType: "cex", estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.binance! * 100, netProceeds: 0, available: false, errorReason: err.message };
  }
}

async function scanMexc(symbol: string, amount: number, tickers: any[]): Promise<VenueResult> {
  const cexSymbol = findCexSymbolFromTickers(tickers, "mexc") || symbol;
  const pairsToTry = [
    `${cexSymbol.toUpperCase()}USDT`,
    `${symbol.toUpperCase()}USDT`,
  ];
  const seen = new Set<string>();
  try {
    let bids: [string, string][] = [];
    let lastError = "";
    for (const pair of pairsToTry) {
      if (seen.has(pair)) continue;
      seen.add(pair);
      const url = `https://api.mexc.com/api/v3/depth?symbol=${pair}&limit=100`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        try {
          const errBody = await res.json() as any;
          lastError = errBody.msg || `MEXC HTTP ${res.status}`;
        } catch { lastError = `MEXC HTTP ${res.status}`; }
        continue;
      }
      const data = await res.json() as any;
      if (data.code && data.code < 0) { lastError = data.msg || "Invalid symbol"; continue; }
      bids = data.bids || [];
      if (bids.length > 0) break;
    }
    const midPrice = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
    if (midPrice === 0) throw new Error(lastError || "Not listed on MEXC");
    const walk = walkBids(bids, amount);
    if (!walk) throw new Error("Not enough liquidity");
    return buildCexResult("MEXC", walk, midPrice, CEX_FEE.mexc!);
  } catch (err: any) {
    return { venue: "MEXC", venueType: "cex", estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.mexc! * 100, netProceeds: 0, available: false, errorReason: err.message };
  }
}

async function scanGateIo(symbol: string, amount: number, tickers: any[]): Promise<VenueResult> {
  const cexSymbol = findCexSymbolFromTickers(tickers, "gate.io") || symbol;
  const pair = `${cexSymbol.toUpperCase()}_USDT`;
  try {
    const url = `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${pair}&limit=100`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Gate.io HTTP ${res.status}`);
    const data = await res.json() as any;
    const bids: [string, string][] = data.bids || [];
    const midPrice = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
    if (midPrice === 0) throw new Error("No bids");
    const walk = walkBids(bids, amount);
    if (!walk) throw new Error("Not enough liquidity");
    return buildCexResult("Gate.io", walk, midPrice, CEX_FEE["gate.io"]!);
  } catch (err: any) {
    return { venue: "Gate.io", venueType: "cex", estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE["gate.io"]! * 100, netProceeds: 0, available: false, errorReason: err.message };
  }
}

async function scanKraken(symbol: string, amount: number, tickers: any[]): Promise<VenueResult> {
  const cexSymbol = findCexSymbolFromTickers(tickers, "kraken") || symbol;
  const pairsToTry = [
    `${cexSymbol.toUpperCase()}USDT`,
    `${cexSymbol.toUpperCase()}USD`,
  ];
  try {
    let bids: [string, string][] = [];
    let lastError = "";
    for (const pair of pairsToTry) {
      const url = `https://api.kraken.com/0/public/Depth?pair=${pair}&count=100`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { lastError = `Kraken HTTP ${res.status}`; continue; }
      const data = await res.json() as any;
      if (data.error && data.error.length > 0) { lastError = data.error[0]; continue; }
      const pairData = data.result?.[Object.keys(data.result || {})[0]];
      bids = (pairData?.bids || []).map((b: any) => [b[0], b[1]]);
      if (bids.length > 0) break;
    }
    const midPrice = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
    if (midPrice === 0) throw new Error(lastError || "No bids");
    const walk = walkBids(bids, amount);
    if (!walk) throw new Error("Not enough liquidity");
    return buildCexResult("Kraken", walk, midPrice, CEX_FEE.kraken!);
  } catch (err: any) {
    return { venue: "Kraken", venueType: "cex", estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.kraken! * 100, netProceeds: 0, available: false, errorReason: err.message };
  }
}

async function scanOkx(symbol: string, amount: number, tickers: any[]): Promise<VenueResult> {
  const cexSymbol = findCexSymbolFromTickers(tickers, "okx") || symbol;
  const pairsToTry = [
    `${cexSymbol.toUpperCase()}-USDT`,
    `${cexSymbol.toUpperCase()}-USDC`,
  ];
  try {
    let bids: [string, string][] = [];
    let lastError = "";
    for (const pair of pairsToTry) {
      const url = `https://www.okx.com/api/v5/market/books?instId=${pair}&sz=100`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) { lastError = `OKX HTTP ${res.status}`; continue; }
      const data = await res.json() as any;
      const bookData = data.data?.[0];
      bids = (bookData?.bids || []).map((b: any) => [b[0], b[1]]);
      if (bids.length > 0) break;
    }
    const midPrice = bids.length > 0 ? parseFloat(bids[0][0]) : 0;
    if (midPrice === 0) throw new Error(lastError || "Not listed on OKX");
    const walk = walkBids(bids, amount);
    if (!walk) throw new Error("Not enough liquidity");
    return buildCexResult("OKX", walk, midPrice, CEX_FEE.okx!);
  } catch (err: any) {
    return { venue: "OKX", venueType: "cex", estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.okx! * 100, netProceeds: 0, available: false, errorReason: err.message };
  }
}

async function getEthPriceUsd(): Promise<number> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return 3000;
    const data = await res.json() as any;
    return data.ethereum?.usd || 3000;
  } catch {
    return 3000;
  }
}

async function callEthRpc(method: string, params: any[]): Promise<any> {
  const LLAMARPC = "https://eth.llamarpc.com";
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const res = await fetchWithTimeout(LLAMARPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }, 10000);
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

function hexToInt(hex: string): bigint {
  return BigInt(hex);
}

function padAddress(addr: string): string {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const DAI  = "0x6b175474e89094c44da98b954eedeac495271d0f";
const UNI_V2_FACTORY = "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f";
const GET_PAIR_SELECTOR = "e6a43905";
const GET_RESERVES_SELECTOR = "0902f1ac";
const TOKEN0_SELECTOR = "0dfe1681";
const TOKEN1_SELECTOR = "d21220a7";
const DECIMALS_SELECTOR = "313ce567";

async function getUniV2PairAddress(tokenA: string, tokenB: string): Promise<string | null> {
  try {
    const data = "0x" + GET_PAIR_SELECTOR + padAddress(tokenA) + padAddress(tokenB);
    const result = await callEthRpc("eth_call", [{ to: UNI_V2_FACTORY, data }, "latest"]);
    if (!result || result === "0x" || result === "0x" + "0".repeat(64)) return null;
    const addr = "0x" + result.slice(26).toLowerCase();
    if (addr === "0x" + "0".repeat(40)) return null;
    return addr;
  } catch {
    return null;
  }
}

async function getUniV2PoolData(poolAddress: string): Promise<{ reserve0: bigint; reserve1: bigint; token0: string; token1: string } | null> {
  try {
    const [reservesHex, token0Hex, token1Hex] = await Promise.all([
      callEthRpc("eth_call", [{ to: poolAddress, data: "0x" + GET_RESERVES_SELECTOR }, "latest"]),
      callEthRpc("eth_call", [{ to: poolAddress, data: "0x" + TOKEN0_SELECTOR }, "latest"]),
      callEthRpc("eth_call", [{ to: poolAddress, data: "0x" + TOKEN1_SELECTOR }, "latest"]),
    ]);

    if (!reservesHex || reservesHex === "0x") return null;

    const hex = reservesHex.startsWith("0x") ? reservesHex.slice(2) : reservesHex;
    const reserve0 = hexToInt("0x" + hex.slice(0, 64));
    const reserve1 = hexToInt("0x" + hex.slice(64, 128));

    const token0 = "0x" + token0Hex.slice(26).toLowerCase();
    const token1 = "0x" + token1Hex.slice(26).toLowerCase();

    return { reserve0, reserve1, token0, token1 };
  } catch (err) {
    logger.error({ err }, "getUniV2PoolData error");
    return null;
  }
}

async function getTokenDecimals(tokenAddress: string): Promise<number> {
  try {
    const result = await callEthRpc("eth_call", [{ to: tokenAddress, data: "0x" + DECIMALS_SELECTOR }, "latest"]);
    if (!result || result === "0x") return 18;
    return Number(hexToInt(result));
  } catch {
    return 18;
  }
}

async function scanUniswapV2(tokenAddress: string, symbol: string, amount: number, ethPriceUsd: number): Promise<VenueResult> {
  const lowerAddress = tokenAddress.toLowerCase();
  const quoteTokens = [
    { address: WETH, decimals: 18, isEth: true, label: "WETH" },
    { address: USDT, decimals: 6, isEth: false, label: "USDT" },
    { address: USDC, decimals: 6, isEth: false, label: "USDC" },
    { address: DAI, decimals: 18, isEth: false, label: "DAI" },
  ];

  try {
    let bestResult: VenueResult | null = null;

    const pairChecks = await Promise.all(
      quoteTokens.map(qt => getUniV2PairAddress(lowerAddress, qt.address))
    );

    for (let i = 0; i < quoteTokens.length; i++) {
      const poolAddress = pairChecks[i];
      if (!poolAddress) continue;

      const qt = quoteTokens[i]!;
      try {
        const poolData = await getUniV2PoolData(poolAddress);
        if (!poolData) continue;

        const { reserve0, reserve1, token0 } = poolData;
        const tokenIsToken0 = token0.toLowerCase() === lowerAddress;

        const tokenDecimals = await getTokenDecimals(tokenAddress);
        const pairedDecimals = qt.decimals;

        const reserveToken = tokenIsToken0 ? reserve0 : reserve1;
        const reservePaired = tokenIsToken0 ? reserve1 : reserve0;

        const reserveTokenAdj = Number(reserveToken) / Math.pow(10, tokenDecimals);
        const reservePairedAdj = Number(reservePaired) / Math.pow(10, pairedDecimals);

        if (reserveTokenAdj === 0 || reservePairedAdj === 0) continue;

        const spotPriceInPaired = reservePairedAdj / reserveTokenAdj;
        const spotPriceUsd = qt.isEth ? spotPriceInPaired * ethPriceUsd : spotPriceInPaired;

        const liquidityUsd = reservePairedAdj * (qt.isEth ? ethPriceUsd : 1) * 2;
        if (liquidityUsd < 100) continue;

        const dx = amount;
        const reserveX = reserveTokenAdj;
        const reserveY = reservePairedAdj;
        const k = reserveX * reserveY;
        const newReserveX = reserveX + dx * 0.997;
        const newReserveY = k / newReserveX;
        const amountOut = reserveY - newReserveY;
        const avgPriceInPaired = amountOut / dx;
        const avgPriceUsd = qt.isEth ? avgPriceInPaired * ethPriceUsd : avgPriceInPaired;
        const slippagePct = ((spotPriceUsd - avgPriceUsd) / spotPriceUsd) * 100;

        const GAS_UNITS = 150000;
        const gasPriceGwei = 20;
        const gasEth = GAS_UNITS * gasPriceGwei * 1e-9;
        const gasEstimateUsd = gasEth * ethPriceUsd;

        const DEX_FEE = 0.003;
        const netProceeds = amountOut * (qt.isEth ? ethPriceUsd : 1) - gasEstimateUsd;

        const result: VenueResult = {
          venue: `Uniswap V2`,
          venueType: "dex",
          estimatedPrice: avgPriceUsd,
          slippagePct: Math.max(0, slippagePct),
          feePct: DEX_FEE * 100,
          netProceeds,
          liquidityUsd,
          gasEstimateUsd,
          available: true,
        };

        if (!bestResult || result.netProceeds > bestResult.netProceeds) {
          bestResult = result;
        }
      } catch (innerErr) {
        logger.debug({ err: innerErr, pair: qt.label }, "V2 pool check failed");
        continue;
      }
    }

    if (bestResult) return bestResult;
    throw new Error("No Uniswap V2 liquidity pool found");
  } catch (err: any) {
    return {
      venue: "Uniswap V2",
      venueType: "dex",
      estimatedPrice: 0,
      slippagePct: 0,
      feePct: 0.3,
      netProceeds: 0,
      available: false,
      errorReason: err.message,
    };
  }
}

async function scanUniswapV3(tokenAddress: string, symbol: string, amount: number, coingeckoTickers: any[], ethPriceUsd: number): Promise<VenueResult> {
  try {
    const DEX_FEE = 0.003;
    const GAS_UNITS = 200000;
    const gasPriceGwei = 20;
    const gasEth = GAS_UNITS * gasPriceGwei * 1e-9;
    const gasEstimateUsd = gasEth * ethPriceUsd;

    const dexIdentifiers = ["uniswap", "sushiswap", "pancakeswap", "curve", "balancer", "quickswap", "trader_joe", "camelot"];
    const stableTargets = ["usdt", "usdc", "dai", "busd", "usd"];
    const ethTargets = ["eth", "weth"];

    const dexTickers = coingeckoTickers?.filter(
      (t: any) => {
        const mktId = (t.market?.identifier || "").toLowerCase();
        return dexIdentifiers.some(id => mktId.includes(id));
      }
    ) || [];

    let uniTicker = dexTickers.find(
      (t: any) => stableTargets.includes(t.target?.toLowerCase())
    );

    if (!uniTicker) {
      uniTicker = dexTickers.find(
        (t: any) => ethTargets.includes(t.target?.toLowerCase())
      );
    }

    if (!uniTicker) {
      uniTicker = coingeckoTickers?.find(
        (t: any) => {
          const mktId = (t.market?.identifier || "").toLowerCase();
          return mktId.includes("dex") || mktId.includes("swap");
        }
      );
    }

    if (!uniTicker) {
      const anyUsdt = coingeckoTickers?.find(
        (t: any) => stableTargets.includes(t.target?.toLowerCase()) && t.last > 0 && t.converted_volume?.usd > 100
      );
      if (anyUsdt) {
        uniTicker = anyUsdt;
      }
    }

    if (!uniTicker) throw new Error("No DEX ticker found");

    if (uniTicker.trust_score === "red" || uniTicker.is_stale) {
      throw new Error("Stale or untrusted DEX ticker");
    }

    const targetLower = (uniTicker.target || "").toLowerCase();
    const isEthTarget = ethTargets.includes(targetLower);
    const spotPriceUsd = isEthTarget
      ? uniTicker.last * ethPriceUsd
      : uniTicker.last;

    if (spotPriceUsd <= 0 || spotPriceUsd < 0.000001) throw new Error("Invalid ticker price");

    const volumeUsd = (uniTicker.converted_volume?.usd || uniTicker.volume * spotPriceUsd);
    const liquidityUsd = volumeUsd * 2;
    const effectiveLiquidity = Math.max(liquidityUsd, 1);
    const priceImpact = Math.min((amount * spotPriceUsd) / effectiveLiquidity, 0.5);
    const slippagePct = priceImpact * 100;

    const avgPriceUsd = spotPriceUsd * (1 - priceImpact);
    const grossProceeds = amount * avgPriceUsd;
    const netProceeds = grossProceeds * (1 - DEX_FEE) - gasEstimateUsd;

    return {
      venue: "Uniswap V3",
      venueType: "dex",
      estimatedPrice: avgPriceUsd,
      slippagePct: Math.max(0, slippagePct),
      feePct: DEX_FEE * 100,
      netProceeds,
      liquidityUsd,
      gasEstimateUsd,
      available: true,
    };
  } catch (err: any) {
    return {
      venue: "Uniswap V3",
      venueType: "dex",
      estimatedPrice: 0,
      slippagePct: 0,
      feePct: 0.3,
      netProceeds: 0,
      available: false,
      errorReason: err.message,
    };
  }
}

function computeSplitSuggestion(results: VenueResult[], amount: number): SplitSuggestion | null {
  const available = results.filter((r) => r.available && r.netProceeds > 0);
  if (available.length < 2) return null;

  const best = available[0];
  if (!best || best.slippagePct <= 2) return null;

  const second = available[1];
  if (!second) return null;

  const splitA = 0.6;
  const splitB = 0.4;

  const proceedsA = (best.netProceeds / amount) * (amount * splitA);
  const proceedsB = (second.netProceeds / amount) * (amount * splitB);
  const totalSplit = proceedsA + proceedsB;
  const improvementVsSingle = totalSplit - best.netProceeds;

  if (improvementVsSingle <= 0) return null;

  return {
    venueA: best.venue,
    venueASharePct: splitA * 100,
    venueB: second.venue,
    venueBSharePct: splitB * 100,
    estimatedNetProceeds: totalSplit,
    improvementVsSingle,
  };
}

export async function scanExitOpportunities(token: string, amount: number): Promise<ScanResult> {
  let tokenInfo: { id: string; symbol: string; platforms: Record<string, string>; tickers: any[] } | null = null;
  let rateLimited = false;

  try {
    tokenInfo = await resolveCoinGeckoToken(token);
  } catch (err: any) {
    if (err?.message === "RATE_LIMITED") {
      rateLimited = true;
      logger.warn("CoinGecko rate limited, falling back to direct CEX queries");
    }
  }

  const isAddress = token.startsWith("0x") && token.length === 42;

  if (!tokenInfo && !rateLimited) {
    return {
      token,
      tokenSymbol: token.toUpperCase(),
      amount,
      results: [],
      bestVenue: null,
      splitSuggestion: null,
      thinLiquidityWarning: false,
      scannedAt: new Date().toISOString(),
    };
  }

  const symbol = tokenInfo?.symbol || (isAddress ? "" : token.toUpperCase());
  const ethAddress = tokenInfo?.platforms?.ethereum || (isAddress ? token : "");
  const tickers = tokenInfo?.tickers || [];

  if (!symbol && isAddress && !tokenInfo) {
    return {
      token,
      tokenSymbol: token.toUpperCase(),
      amount,
      results: [],
      bestVenue: null,
      splitSuggestion: null,
      thinLiquidityWarning: false,
      scannedAt: new Date().toISOString(),
    };
  }

  const [ethPriceUsd, binanceResult, mexcResult, gateResult, krakenResult, okxResult] = await Promise.all([
    getEthPriceUsd(),
    symbol ? scanBinance(symbol, amount, tickers) : Promise.resolve({ venue: "Binance", venueType: "cex" as const, estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.binance! * 100, netProceeds: 0, available: false, errorReason: "Cannot resolve token" }),
    symbol ? scanMexc(symbol, amount, tickers) : Promise.resolve({ venue: "MEXC", venueType: "cex" as const, estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.mexc! * 100, netProceeds: 0, available: false, errorReason: "Cannot resolve token" }),
    symbol ? scanGateIo(symbol, amount, tickers) : Promise.resolve({ venue: "Gate.io", venueType: "cex" as const, estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE["gate.io"]! * 100, netProceeds: 0, available: false, errorReason: "Cannot resolve token" }),
    symbol ? scanKraken(symbol, amount, tickers) : Promise.resolve({ venue: "Kraken", venueType: "cex" as const, estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.kraken! * 100, netProceeds: 0, available: false, errorReason: "Cannot resolve token" }),
    symbol ? scanOkx(symbol, amount, tickers) : Promise.resolve({ venue: "OKX", venueType: "cex" as const, estimatedPrice: 0, slippagePct: 0, feePct: CEX_FEE.okx! * 100, netProceeds: 0, available: false, errorReason: "Cannot resolve token" }),
  ]);

  const dexResults: VenueResult[] = [];

  if (ethAddress) {
    const [v2Result, v3Result] = await Promise.all([
      scanUniswapV2(ethAddress, symbol, amount, ethPriceUsd),
      scanUniswapV3(ethAddress, symbol, amount, tickers, ethPriceUsd),
    ]);
    dexResults.push(v2Result, v3Result);
  } else {
    const v3Fallback = await scanUniswapV3("", symbol, amount, tickers, ethPriceUsd);
    dexResults.push(v3Fallback);
  }

  const allResults: VenueResult[] = [
    binanceResult,
    mexcResult,
    gateResult,
    krakenResult,
    okxResult,
    ...dexResults,
  ].sort((a, b) => b.netProceeds - a.netProceeds);

  const availableResults = allResults.filter((r) => r.available);
  const bestVenue = availableResults.length > 0 ? availableResults[0]!.venue : null;

  const thinLiquidityWarning = availableResults.some((r) => r.slippagePct > 5);

  const splitSuggestion = computeSplitSuggestion(availableResults, amount);

  return {
    token,
    tokenSymbol: symbol,
    amount,
    results: allResults,
    bestVenue,
    splitSuggestion,
    thinLiquidityWarning,
    scannedAt: new Date().toISOString(),
  };
}
