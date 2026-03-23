import React, { useState, useMemo } from "react";
import { useGetPrices } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const CHAINS = ["all", "ethereum", "arbitrum", "base", "bsc", "polygon", "optimism", "avalanche"] as const;
const PAGE_SIZE = 50;

const CHAIN_COLORS: Record<string, string> = {
  ethereum: "border-blue-500/50 text-blue-400",
  arbitrum: "border-sky-500/50 text-sky-400",
  base: "border-blue-400/50 text-blue-300",
  bsc: "border-yellow-500/50 text-yellow-400",
  polygon: "border-purple-500/50 text-purple-400",
  optimism: "border-red-500/50 text-red-400",
  avalanche: "border-orange-500/50 text-orange-400",
};

export function PriceTable() {
  const [search, setSearch] = useState("");
  const [chain, setChain] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: prices, isLoading } = useGetPrices(
    chain !== "all" ? { chain } : {},
    { query: { refetchInterval: 5000 } }
  );

  const filtered = useMemo(() => {
    if (!prices) return [];
    const q = search.toLowerCase();
    return prices.filter(p =>
      p.pair.toLowerCase().includes(q) ||
      p.venue.toLowerCase().includes(q) ||
      (p.baseToken ?? "").toLowerCase().includes(q)
    );
  }, [prices, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleChainChange = (c: string) => {
    setChain(c);
    setPage(0);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(0);
  };

  return (
    <Card className="flex flex-col h-full bg-card border-border/50">
      <CardHeader className="pb-3 border-b border-border/50 space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Market Prices
            {prices && (
              <span className="ml-2 text-xs text-muted-foreground/60 normal-case font-normal">
                ({filtered.length.toLocaleString()} entries)
              </span>
            )}
          </CardTitle>
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search token, venue..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="h-7 pl-8 bg-background font-mono text-xs border-border/50 focus-visible:ring-primary"
            />
          </div>
        </div>

        <div className="flex gap-1 flex-wrap">
          {CHAINS.map((c) => (
            <button
              key={c}
              onClick={() => handleChainChange(c)}
              className={cn(
                "px-2 py-0.5 text-[10px] font-mono uppercase rounded border transition-colors",
                chain === c
                  ? "bg-primary/20 border-primary text-primary"
                  : "border-border/50 text-muted-foreground hover:border-muted-foreground/50"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0 overflow-auto flex-1">
        <Table>
          <TableHeader className="bg-muted/20 sticky top-0 backdrop-blur-sm">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-mono text-[11px] w-[180px]">Venue</TableHead>
              <TableHead className="font-mono text-[11px]">Pair</TableHead>
              <TableHead className="font-mono text-[11px] text-right">Price</TableHead>
              <TableHead className="font-mono text-[11px] text-right hidden md:table-cell">Chain</TableHead>
              <TableHead className="font-mono text-[11px] text-right hidden lg:table-cell">Liquidity</TableHead>
              <TableHead className="font-mono text-[11px] text-right hidden lg:table-cell">Volume 24h</TableHead>
              <TableHead className="font-mono text-[11px] text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !prices ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <div className="flex justify-center">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                </TableCell>
              </TableRow>
            ) : !paginated.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center font-mono text-muted-foreground text-xs">
                  {search ? "NO_MATCHES_FOUND" : "AWAITING_DATA..."}
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((price) => (
                <TableRow key={price.id} className="border-border/20 hover:bg-muted/30 transition-colors">
                  <TableCell className="py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-xs truncate max-w-[120px]">{price.venue}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] uppercase px-1 py-0 h-3.5 hidden sm:inline-flex shrink-0",
                          price.source === "dex" ? "border-emerald-500/40 text-emerald-500" : "border-blue-500/40 text-blue-400"
                        )}
                      >
                        {price.source}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono font-bold text-xs py-2">{price.pair}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-foreground py-2">
                    ${price.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: price.price < 0.01 ? 8 : 4 })}
                  </TableCell>
                  <TableCell className="text-right hidden md:table-cell py-2">
                    {price.chain ? (
                      <Badge
                        variant="outline"
                        className={cn("text-[9px] px-1 py-0 h-3.5", CHAIN_COLORS[price.chain] ?? "border-muted text-muted-foreground")}
                      >
                        {price.chain}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">–</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground hidden lg:table-cell py-2">
                    {price.liquidityUsd
                      ? price.liquidityUsd >= 1_000_000
                        ? `$${(price.liquidityUsd / 1_000_000).toFixed(1)}M`
                        : `$${(price.liquidityUsd / 1000).toFixed(1)}k`
                      : "–"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground hidden lg:table-cell py-2">
                    {price.volume24h
                      ? price.volume24h >= 1_000_000
                        ? `$${(price.volume24h / 1_000_000).toFixed(1)}M`
                        : `$${(price.volume24h / 1000).toFixed(1)}k`
                      : "–"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[10px] text-muted-foreground py-2">
                    {new Date(price.time).toLocaleTimeString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/10">
          <span className="text-xs font-mono text-muted-foreground">
            Page {page + 1} / {totalPages} · {filtered.length.toLocaleString()} total
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
