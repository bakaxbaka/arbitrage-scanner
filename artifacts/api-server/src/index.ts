import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initWebSocketServer } from "./lib/wsServer";
import { startCexIngestion } from "./lib/cexIngestion";
import { startDexIngestion } from "./lib/dexIngestion";
import { startArbitrageDetection } from "./lib/arbitrageDetection";
import { startChainScanner } from "./lib/chainScanner";
import { startGateScanner } from "./lib/gateScanner";
import { startCurrencyInfoCache } from "./lib/currencyInfoCache";
import { startDexPoolScanner } from "./lib/dexPoolScanner";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

initWebSocketServer(server);

server.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  startDexIngestion();
  startCexIngestion();
  startGateScanner();

  // Load currency info (withdraw/deposit + KuCoin contract addresses) first.
  // Once loaded, start the arbitrage engine and the DEX pool scanner which
  // uses KuCoin contract addresses to query DexScreener per-chain.
  startCurrencyInfoCache()
    .catch((err) => logger.error({ err }, "Currency info cache failed to start"))
    .finally(() => {
      setTimeout(() => {
        startArbitrageDetection();
      }, 5000);

      // DEX pool scanner: queries DexScreener using KuCoin contract data.
      // Has its own internal warm-up delay so we don't hammer DexScreener
      // immediately on startup.
      startDexPoolScanner();
    });

  // CoinGecko top-1000 chain scanner — starts 60 s after boot to avoid
  // competing with the fast-path scanners during the warm-up window.
  setTimeout(() => {
    startChainScanner();
  }, 60_000);
});
