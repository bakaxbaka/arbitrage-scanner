import React, { useState, useMemo, useCallback } from "react";
import { useGetPrices } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, ScanLine, Loader2, ExternalLink, X, AlertCircle, CheckCircle2 } from "lucide-react";
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
  zksync: "border-violet-500/50 text-violet-400",
  linea: "border-indigo-500/50 text-indigo-400",
  scroll: "border-amber-500/50 text-amber-400",
};

const CONTRACT_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface ScanResult {
  found: boolean;
  address?: string;
  message?: string;
  chainsFound?: number;
  totalPairsFound?: number;
  prices?: Array<{
    chain: string;
    dex: string;
    venue: string;
    pair: string;
    symbol: string;
    name: string;
    address: string;
    pairAddress: string;
    priceUsd: number;
    volume24h: number | null;
    liquidityUsd: number | null;
    priceChange24h: number | null;
    dexUrl: string;
  }>;
}

function isContractAddress(value: string): boolean {
  return CONTRACT_ADDRESS_RE.test(value.trim());
}

function formatUsd(value: number | null | undefined): string {
  if (value == null) return "–";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return `$${value.toFixed(2)}`;
}

function formatPrice(price: number): string {
  if (price >= 1000) return `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(4)}`;
}

export function PriceTable() {
  const [search, setSearch] = useState("");
  const [chain, setChain] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  const isAddress = isContractAddress(search);

  const { data: prices, isLoading, refetch } = useGetPrices(
    chain !== "all" ? { chain } : {},
    { query: { refetchInterval: 5000 } }
  );

  const filtered = useMemo(() => {
    if (!prices) return [];
    const q = search.toLowerCase().trim();
    if (!q || isAddress) return prices;
    return prices.filter(p =>
      p.pair.toLowerCase().includes(q) ||
      p.venue.toLowerCase().includes(q) ||
      (p.baseToken ?? "").toLowerCase().includes(q)
    );
  }, [prices, search, isAddress]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleChainChange = (c: string) => {
    setChain(c);
    setPage(0);
  };

  const handleSearch = (v: string) => {
    setSearch(v);
    setPage(0);
    if (!isContractAddress(v)) {
      setScanResult(null);
      setScanError(null);
    }
  };

  const handleScan = useCallback(async () => {
    const address = search.trim();
    if (!isContractAddress(address)) return;

    setScanning(true);
    setScanResult(null);
    setScanError(null);

    try {
      const res = await fetch(`/api/v1/scan-contract?address=${encodeURIComponent(address)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setScanError((err as { error: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as ScanResult;
      setScanResult(data);
      if (data.found) {
        refetch();
      }
    } catch (err) {
      setScanError("Network error — check connection");
    } finally {
      setScanning(false);
    }
  }, [search, refetch]);

  const clearScan = () => {
    setSearch("");
    setScanResult(null);
    setScanError(null);
  };

  return (
    <Card className="flex flex-col h-full bg-card border-border/50">
      <CardHeader className="pb-3 border-b border-border/50 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground shrink-0">
            Market Prices
            {prices && !isAddress && (
              <span className="ml-2 text-xs text-muted-foreground/60 normal-case font-normal">
                ({filtered.length.toLocaleString()} entries)
              </span>
            )}
          </CardTitle>

          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <div className="relative flex-1">
              {isAddress ? (
                <ScanLine className="absolute left-2.5 top-2 h-3.5 w-3.5 text-primary" />
              ) : (
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              )}
              <Input
                placeholder="Search token, venue or paste 0x address..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className={cn(
                  "h-7 pl-8 pr-8 bg-background font-mono text-xs border-border/50 focus-visible:ring-primary",
                  isAddress && "border-primary/50 ring-1 ring-primary/20"
                )}
              />
              {search && (
                <button
                  onClick={clearScan}
                  className="absolute right-2 top-1.5 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {isAddress && (
              <Button
                size="sm"
                className="h-7 px-3 text-xs font-mono shrink-0 bg-primary/20 hover:bg-primary/30 border border-primary/50 text-primary"
                onClick={handleScan}
                disabled={scanning}
              >
                {scanning ? (
                  <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />Scanning…</>
                ) : (
                  <><ScanLine className="h-3 w-3 mr-1.5" />Scan</>
                )}
              </Button>
            )}
          </div>
        </div>

        {!isAddress && (
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
        )}

        {isAddress && !scanResult && !scanError && !scanning && (
          <p className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
            <ScanLine className="h-3 w-3 text-primary" />
            Contract address detected — click <span className="text-primary">Scan</span> to search across all EVM chains
          </p>
        )}

        {scanError && (
          <div className="flex items-center gap-2 text-xs text-destructive font-mono bg-destructive/10 rounded px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {scanError}
          </div>
        )}
      </CardHeader>

      {scanResult && isAddress ? (
        <div className="flex-1 overflow-auto">
          {!scanResult.found ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm font-mono gap-2">
              <AlertCircle className="h-6 w-6 opacity-50" />
              <span>{scanResult.message ?? "No pairs found"}</span>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-border/50 bg-muted/10 flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                <span className="font-mono text-xs text-muted-foreground">
                  Found <span className="text-primary font-bold">{scanResult.chainsFound}</span> chains ·{" "}
                  <span className="text-primary font-bold">{scanResult.totalPairsFound}</span> total pairs for{" "}
                  <span className="text-foreground">{scanResult.prices?.[0]?.name ?? search}</span>
                  {" "}(<span className="text-foreground font-bold">{scanResult.prices?.[0]?.symbol}</span>)
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/60 truncate max-w-[200px]">
                  {search}
                </span>
              </div>

              <Table>
                <TableHeader className="bg-muted/20 sticky top-0 backdrop-blur-sm">
                  <TableRow className="border-border/50 hover:bg-transparent">
                    <TableHead className="font-mono text-[11px]">Chain · DEX</TableHead>
                    <TableHead className="font-mono text-[11px] text-right">Price (USD)</TableHead>
                    <TableHead className="font-mono text-[11px] text-right hidden md:table-cell">Liquidity</TableHead>
                    <TableHead className="font-mono text-[11px] text-right hidden md:table-cell">Vol 24h</TableHead>
                    <TableHead className="font-mono text-[11px] text-right hidden lg:table-cell">Δ 24h</TableHead>
                    <TableHead className="font-mono text-[11px] w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scanResult.prices?.map((p, i) => (
                    <TableRow key={i} className="border-border/20 hover:bg-muted/30 transition-colors">
                      <TableCell className="py-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn("text-[9px] px-1 py-0 h-3.5 shrink-0", CHAIN_COLORS[p.chain] ?? "border-muted text-muted-foreground")}
                          >
                            {p.chain}
                          </Badge>
                          <span className="font-mono text-xs text-muted-foreground truncate max-w-[120px]">
                            {p.dex}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold py-2">
                        {formatPrice(p.priceUsd)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground hidden md:table-cell py-2">
                        {formatUsd(p.liquidityUsd)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground hidden md:table-cell py-2">
                        {formatUsd(p.volume24h)}
                      </TableCell>
                      <TableCell className={cn(
                        "text-right font-mono text-xs hidden lg:table-cell py-2",
                        (p.priceChange24h ?? 0) >= 0 ? "text-emerald-400" : "text-destructive"
                      )}>
                        {p.priceChange24h != null ? `${p.priceChange24h >= 0 ? "+" : ""}${p.priceChange24h.toFixed(2)}%` : "–"}
                      </TableCell>
                      <TableCell className="py-2">
                        <a
                          href={p.dexUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary transition-colors"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {(scanResult.prices?.length ?? 0) > 1 && (
                <div className="px-4 py-3 border-t border-border/50 bg-muted/10">
                  <p className="text-[10px] font-mono text-muted-foreground">
                    ARBITRAGE SPREAD:{" "}
                    {(() => {
                      const p = scanResult.prices!;
                      const prices = p.map((x) => x.priceUsd);
                      const min = Math.min(...prices);
                      const max = Math.max(...prices);
                      const spread = ((max - min) / min) * 100;
                      return (
                        <span className={cn("font-bold", spread > 0.5 ? "text-primary" : "text-emerald-400")}>
                          {spread.toFixed(4)}%
                        </span>
                      );
                    })()}
                    {" "}·{" "}
                    Buy on{" "}
                    <span className="text-emerald-400">
                      {scanResult.prices!.reduce((a, b) => a.priceUsd < b.priceUsd ? a : b).chain}
                    </span>
                    {" "}→ Sell on{" "}
                    <span className="text-primary">
                      {scanResult.prices!.reduce((a, b) => a.priceUsd > b.priceUsd ? a : b).chain}
                    </span>
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
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
                        {formatPrice(price.price)}
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
                        {formatUsd(price.liquidityUsd)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground hidden lg:table-cell py-2">
                        {formatUsd(price.volume24h)}
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
        </>
      )}
    </Card>
  );
}
