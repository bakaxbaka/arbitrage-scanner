import { pgTable, text, decimal, bigint, timestamp, serial, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricesTable = pgTable(
  "prices",
  {
    id: serial("id").primaryKey(),
    time: timestamp("time", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    venue: text("venue").notNull(),
    chain: text("chain"),
    pair: text("pair").notNull(),
    baseToken: text("base_token").notNull(),
    quoteToken: text("quote_token").notNull(),
    price: decimal("price", { precision: 36, scale: 18 }).notNull(),
    volume24h: decimal("volume_24h", { precision: 36, scale: 18 }),
    liquidityUsd: decimal("liquidity_usd", { precision: 36, scale: 2 }),
    bid: decimal("bid", { precision: 36, scale: 18 }),
    ask: decimal("ask", { precision: 36, scale: 18 }),
    blockNumber: bigint("block_number", { mode: "number" }),
    txHash: text("tx_hash"),
  },
  (table) => [
    index("idx_prices_latest").on(table.source, table.venue, table.pair, table.time),
    index("idx_prices_pair").on(table.pair, table.time),
  ]
);

export const insertPriceSchema = createInsertSchema(pricesTable).omit({ id: true });
export type InsertPrice = z.infer<typeof insertPriceSchema>;
export type Price = typeof pricesTable.$inferSelect;
