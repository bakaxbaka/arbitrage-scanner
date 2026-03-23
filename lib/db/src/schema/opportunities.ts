import { pgTable, text, decimal, integer, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";

export const opportunitiesTable = pgTable(
  "opportunities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    buyVenue: text("buy_venue").notNull(),
    sellVenue: text("sell_venue").notNull(),
    buySource: text("buy_source").notNull(),
    sellSource: text("sell_source").notNull(),
    pair: text("pair").notNull(),
    buyPrice: decimal("buy_price", { precision: 36, scale: 18 }).notNull(),
    sellPrice: decimal("sell_price", { precision: 36, scale: 18 }).notNull(),
    spreadPercent: decimal("spread_percent", { precision: 10, scale: 4 }).notNull(),
    profitUsd: decimal("profit_usd", { precision: 36, scale: 2 }).notNull(),
    gasCostEth: decimal("gas_cost_eth", { precision: 36, scale: 18 }),
    netProfitUsd: decimal("net_profit_usd", { precision: 36, scale: 2 }),
    buyLiquidity: decimal("buy_liquidity", { precision: 36, scale: 2 }),
    sellLiquidity: decimal("sell_liquidity", { precision: 36, scale: 2 }),
    status: text("status").notNull().default("active"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("idx_opportunities_time").on(table.detectedAt),
    index("idx_opportunities_status").on(table.status, table.detectedAt),
  ]
);

export const insertOpportunitySchema = createInsertSchema(opportunitiesTable).omit({ id: true });
export type InsertOpportunity = z.infer<typeof insertOpportunitySchema>;
export type Opportunity = typeof opportunitiesTable.$inferSelect;
