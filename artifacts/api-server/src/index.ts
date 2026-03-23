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

  // Load currency info (withdraw/deposit status + contract addresses) before
  // the arbitrage engine starts, so filters have data from the first cycle.
  startCurrencyInfoCache()
    .catch((err) => logger.error({ err }, "Currency info cache failed to start"))
    .finally(() => {
      setTimeout(() => {
        startArbitrageDetection();
      }, 5000);
    });

  setTimeout(() => {
    startChainScanner();
  }, 60_000);
});
