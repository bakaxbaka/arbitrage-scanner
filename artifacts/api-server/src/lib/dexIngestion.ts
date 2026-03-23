import { createPublicClient, http, type PublicClient, type Abi } from "viem";
import { mainnet, arbitrum, base, bsc } from "viem/chains";
import { priceStore } from "./priceStore";
import { broadcast } from "./wsServer";
import { logger } from "./logger";

const UNISWAP_V3_POOL_ABI = [
  {
    inputs: [],
    name: "slot0",
    outputs: [
      { internalType: "uint160", name: "sqrtPriceX96", type: "uint160" },
      { internalType: "int24", name: "tick", type: "int24" },
      { internalType: "uint16", name: "observationIndex", type: "uint16" },
      { internalType: "uint16", name: "observationCardinality", type: "uint16" },
      { internalType: "uint16", name: "observationCardinalityNext", type: "uint16" },
      { internalType: "uint8", name: "feeProtocol", type: "uint8" },
      { internalType: "bool", name: "unlocked", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "liquidity",
    outputs: [{ internalType: "uint128", name: "", type: "uint128" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

const CURVE_POOL_ABI = [
  {
    inputs: [
      { internalType: "int128", name: "i", type: "int128" },
      { internalType: "int128", name: "j", type: "int128" },
      { internalType: "uint256", name: "dx", type: "uint256" },
    ],
    name: "get_dy",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const satisfies Abi;

function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, token0Decimals: number, token1Decimals: number): number {
  const Q96 = 2n ** 96n;
  const price = Number((sqrtPriceX96 * sqrtPriceX96 * BigInt(10 ** token0Decimals)) / (Q96 * Q96 * BigInt(10 ** token1Decimals)));
  return price;
}

const RPC_URLS = {
  ethereum: process.env.ETH_RPC_URL ?? "https://eth.llamarpc.com",
  arbitrum: process.env.ARB_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
  base: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
  bsc: process.env.BSC_RPC_URL ?? "https://bsc-dataseed.binance.org",
};

const clients: Record<string, PublicClient> = {
  ethereum: createPublicClient({ chain: mainnet, transport: http(RPC_URLS.ethereum) }) as PublicClient,
  arbitrum: createPublicClient({ chain: arbitrum, transport: http(RPC_URLS.arbitrum) }) as PublicClient,
  base: createPublicClient({ chain: base, transport: http(RPC_URLS.base) }) as PublicClient,
  bsc: createPublicClient({ chain: bsc, transport: http(RPC_URLS.bsc) }) as PublicClient,
};

interface PoolConfig {
  venue: string;
  chain: string;
  poolAddress: `0x${string}`;
  pair: string;
  base: string;
  quote: string;
  token0Decimals: number;
  token1Decimals: number;
  invertPrice: boolean;
  type: "uniswapV3" | "curveStable";
}

const POOLS: PoolConfig[] = [
  {
    venue: "Uniswap V3 / Ethereum",
    chain: "ethereum",
    poolAddress: "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
    pair: "ETH/USDT",
    base: "ETH",
    quote: "USDT",
    token0Decimals: 6,
    token1Decimals: 18,
    invertPrice: true,
    type: "uniswapV3",
  },
  {
    venue: "Uniswap V3 / Arbitrum",
    chain: "arbitrum",
    poolAddress: "0xC6962004f452bE9203591991D15f6b388e09E8D0",
    pair: "ETH/USDT",
    base: "ETH",
    quote: "USDT",
    token0Decimals: 18,
    token1Decimals: 6,
    invertPrice: false,
    type: "uniswapV3",
  },
  {
    venue: "Uniswap V3 / Base",
    chain: "base",
    poolAddress: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
    pair: "ETH/USDT",
    base: "ETH",
    quote: "USDT",
    token0Decimals: 18,
    token1Decimals: 6,
    invertPrice: false,
    type: "uniswapV3",
  },
  {
    venue: "PancakeSwap V3 / BSC",
    chain: "bsc",
    poolAddress: "0x46Cf1cF8c69595804ba91dFdd8d6b960c9B0a7C4",
    pair: "BTC/USDT",
    base: "BTC",
    quote: "USDT",
    token0Decimals: 18,
    token1Decimals: 18,
    invertPrice: false,
    type: "uniswapV3",
  },
  {
    venue: "Curve 3Pool / Ethereum",
    chain: "ethereum",
    poolAddress: "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7",
    pair: "USDC/USDT",
    base: "USDC",
    quote: "USDT",
    token0Decimals: 6,
    token1Decimals: 6,
    invertPrice: false,
    type: "curveStable",
  },
];

async function fetchUniswapV3Price(client: PublicClient, pool: PoolConfig): Promise<{ price: number; liquidityUsd: number } | null> {
  try {
    const [slot0Result, liquidityResult] = await Promise.all([
      client.readContract({
        address: pool.poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "slot0",
      }),
      client.readContract({
        address: pool.poolAddress,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "liquidity",
      }),
    ]);

    const sqrtPriceX96 = slot0Result[0] as bigint;
    if (sqrtPriceX96 === 0n) return null;

    let price = sqrtPriceX96ToPrice(sqrtPriceX96, pool.token0Decimals, pool.token1Decimals);
    if (pool.invertPrice && price > 0) price = 1 / price;

    const liquidityRaw = liquidityResult as bigint;
    const liquidityUsd = Number(liquidityRaw) / 1e12 * price;

    return { price, liquidityUsd };
  } catch (err) {
    logger.warn({ err, venue: pool.venue }, "Failed to fetch Uniswap V3 pool data");
    return null;
  }
}

async function fetchCurveStablePrice(client: PublicClient, pool: PoolConfig): Promise<{ price: number; liquidityUsd: number } | null> {
  try {
    const amountIn = BigInt(10 ** pool.token0Decimals);
    const result = await client.readContract({
      address: pool.poolAddress,
      abi: CURVE_POOL_ABI,
      functionName: "get_dy",
      args: [0n, 1n, amountIn],
    });

    const amountOut = result as bigint;
    const price = Number(amountOut) / 10 ** pool.token1Decimals;
    return { price, liquidityUsd: 500_000_000 };
  } catch (err) {
    logger.warn({ err, venue: pool.venue }, "Failed to fetch Curve pool data");
    return null;
  }
}

async function pollPool(pool: PoolConfig) {
  const client = clients[pool.chain];
  if (!client) return;

  let result: { price: number; liquidityUsd: number } | null = null;

  if (pool.type === "uniswapV3") {
    result = await fetchUniswapV3Price(client, pool);
  } else if (pool.type === "curveStable") {
    result = await fetchCurveStablePrice(client, pool);
  }

  if (!result || result.price <= 0) return;

  const poolFee = 0.003;
  priceStore.set({
    source: "dex",
    venue: pool.venue,
    chain: pool.chain,
    pair: pool.pair,
    baseToken: pool.base,
    quoteToken: pool.quote,
    price: result.price,
    bid: result.price * (1 - poolFee),
    ask: result.price * (1 + poolFee),
    liquidityUsd: result.liquidityUsd,
    updatedAt: new Date(),
  });

  broadcast("price_update", {
    source: "dex",
    venue: pool.venue,
    chain: pool.chain,
    pair: pool.pair,
    price: result.price,
  });
}

async function pollAllPools() {
  await Promise.allSettled(POOLS.map((pool) => pollPool(pool)));
}

export function startDexIngestion() {
  logger.info("Starting on-chain DEX data ingestion via viem...");
  pollAllPools().catch((err) => logger.error({ err }, "Initial DEX poll failed"));
  setInterval(() => {
    pollAllPools().catch((err) => logger.error({ err }, "DEX poll failed"));
  }, 30_000);
}
