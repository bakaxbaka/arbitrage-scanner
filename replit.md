# Workspace

## Overview

Cross-Platform Arbitrage Scanner — a real-time dashboard monitoring crypto price discrepancies between CEXs (Binance, Coinbase, Bybit, OKX) and DEXs (Uniswap V3, Curve, PancakeSwap), detecting and displaying arbitrage opportunities.

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)
- **Frontend**: React + Vite, TanStack React Query
- **Charts**: Recharts
- **Animations**: Framer Motion

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server with WebSocket
│   └── arbitrage-dashboard/ # React Vite frontend dashboard
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## Features

### Data Ingestion
- **CEX WebSocket connections**: Binance, Coinbase, Bybit, OKX
- **DEX polling via CoinGecko API**: Uniswap V3 (Ethereum, Arbitrum, Base), Curve 3pool, PancakeSwap BSC
- Price store singleton (in-memory, ~1 min freshness window)

### Arbitrage Detection
- Runs every 3 seconds on in-memory price store
- Compares all venue pairs per trading pair
- Filters by min spread (0.05%) and positive net profit after gas
- Persists top 20 opportunities to DB per cycle

### API Endpoints
- `GET /api/healthz` — health check
- `GET /api/v1/prices` — current prices (filterable by pair, source, chain)
- `GET /api/v1/opportunities` — live arbitrage opportunities
- `GET /api/v1/analytics/spread-history` — historical spreads from DB
- `GET /api/v1/stats` — dashboard aggregate stats
- `WS /ws` — real-time broadcast (price_update, opportunity, opportunities_update)

### Dashboard
- Stats header (active opps, max spread, avg spread, venues, pairs)
- Spread matrix grid (color-coded, per pair)
- Spread history chart (Recharts line chart)
- Live opportunity feed (buy venue → sell venue, spread %, estimated profit)
- Market prices table (all venues, bid/ask, liquidity)

## Database Schema

### `prices` table
Time-series price records from all sources.

### `opportunities` table
Detected arbitrage opportunities with spread %, profit, gas cost, status.

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server with WebSocket support. Ingests CEX/DEX price data, runs arbitrage detection, serves REST API.

- Entry: `src/index.ts` — reads `PORT`, creates HTTP server, initializes WebSocket, starts ingestion
- Libs: `src/lib/priceStore.ts`, `src/lib/wsServer.ts`, `src/lib/cexIngestion.ts`, `src/lib/dexIngestion.ts`, `src/lib/arbitrageDetection.ts`
- Routes: `src/routes/prices.ts`, `src/routes/opportunities.ts`, `src/routes/analytics.ts`, `src/routes/health.ts`

### `artifacts/arbitrage-dashboard` (`@workspace/arbitrage-dashboard`)

React + Vite dashboard. Dark trading terminal aesthetic.
- Pages: `src/pages/dashboard.tsx`
- Components: stats-header, spread-matrix, opportunity-feed, price-table, spread-chart, layout
- Hooks: `use-websocket.ts` for real-time updates

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

- `src/schema/prices.ts` — prices table
- `src/schema/opportunities.ts` — opportunities table

### `lib/api-spec` (`@workspace/api-spec`)

OpenAPI 3.1 spec + Orval codegen config.
Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` + `lib/api-client-react`

Generated Zod schemas and React Query hooks from OpenAPI spec.
