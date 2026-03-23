import React, { useState } from "react";
import { Search, TrendingDown, AlertTriangle, Zap, CheckCircle, Info, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface VenueResult {
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

interface SplitSuggestion {
  venueA: string;
  venueASharePct: number;
  venueB: string;
  venueBSharePct: number;
  estimatedNetProceeds: number;
  improvementVsSingle: number;
}

interface ScanResult {
  token: string;
  tokenSymbol: string;
  amount: number;
  results: VenueResult[];
  bestVenue: string | null;
  splitSuggestion: SplitSuggestion | null;
  thinLiquidityWarning: boolean;
  scannedAt: string;
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(4)}`;
}

function formatPct(value: number): string {
  return `${value.toFixed(3)}%`;
}

export function ExitOptimizer() {
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getApiBase = () => {
    const base = import.meta.env.BASE_URL || "/";
    const trimmed = base.replace(/\/$/, "");
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length > 0) {
      parts[parts.length - 1] = "api";
    } else {
      return "/api";
    }
    return "/" + parts.join("/");
  };

  const handleScan = async () => {
    if (!token.trim() || !amount.trim()) return;
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError("Please enter a valid positive amount.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/exit-optimizer/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), amount: parsedAmount }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as any;
        throw new Error(errData.error || `Server error: ${res.status}`);
      }

      const data = await res.json() as ScanResult;
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Scan failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleScan();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-border/50 bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <TrendingDown className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-mono font-bold uppercase tracking-wider text-primary">Exit Optimizer</h2>
        </div>

        <p className="text-xs text-muted-foreground mb-4 font-mono">
          Find the best venue to sell your tokens — accounting for slippage, orderbook depth, and fees.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs font-mono text-muted-foreground mb-1">TOKEN</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="BOND or 0x0391D2..."
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
          <div className="w-full sm:w-40">
            <label className="block text-xs font-mono text-muted-foreground mb-1">AMOUNT TO SELL</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="1000"
              min="0"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleScan}
              disabled={loading || !token.trim() || !amount.trim()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-mono font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              {loading ? "SCANNING..." : "SCAN"}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-mono font-medium text-destructive">SCAN ERROR</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{error}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-border/50 bg-card p-8 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
          <p className="text-sm font-mono text-muted-foreground">Scanning CEX orderbooks and DEX pools...</p>
          <p className="text-xs font-mono text-muted-foreground/60">Checking Binance, MEXC, Gate.io, Kraken, OKX, Uniswap V2/V3</p>
        </div>
      )}

      {result && !loading && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">TOKEN:</span>
              <Badge variant="outline" className="font-mono text-primary border-primary/50">{result.tokenSymbol}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-muted-foreground">SELL:</span>
              <span className="text-xs font-mono text-foreground">{result.amount.toLocaleString()} {result.tokenSymbol}</span>
            </div>
            {result.bestVenue && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">BEST:</span>
                <Badge className="font-mono bg-primary/20 text-primary border-primary/50">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  {result.bestVenue}
                </Badge>
              </div>
            )}
          </div>

          {result.thinLiquidityWarning && (
            <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-mono font-medium text-yellow-500">THIN LIQUIDITY WARNING</p>
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  One or more venues have &gt;5% slippage for this order size. Consider splitting your order or reducing the sell amount.
                </p>
              </div>
            </div>
          )}

          {result.splitSuggestion && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-xs font-mono font-bold text-primary uppercase">Split Order Suggestion</span>
              </div>
              <p className="text-xs font-mono text-muted-foreground mb-3">
                Splitting across venues could improve your net proceeds:
              </p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="rounded-md bg-background border border-border/50 p-3">
                  <p className="text-xs font-mono text-muted-foreground">{result.splitSuggestion.venueASharePct}% via</p>
                  <p className="text-sm font-mono font-bold text-foreground">{result.splitSuggestion.venueA}</p>
                </div>
                <div className="rounded-md bg-background border border-border/50 p-3">
                  <p className="text-xs font-mono text-muted-foreground">{result.splitSuggestion.venueBSharePct}% via</p>
                  <p className="text-sm font-mono font-bold text-foreground">{result.splitSuggestion.venueB}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-muted-foreground">ESTIMATED NET PROCEEDS:</span>
                <span className="text-primary font-bold">{formatUsd(result.splitSuggestion.estimatedNetProceeds)}</span>
              </div>
              <div className="flex items-center justify-between text-xs font-mono mt-1">
                <span className="text-muted-foreground">IMPROVEMENT VS SINGLE VENUE:</span>
                <span className="text-green-400 font-bold">+{formatUsd(result.splitSuggestion.improvementVsSingle)}</span>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border/50 bg-card overflow-hidden">
            <div className="grid grid-cols-6 gap-2 px-4 py-2 border-b border-border/50 bg-muted/30">
              <span className="text-xs font-mono text-muted-foreground col-span-2">VENUE</span>
              <span className="text-xs font-mono text-muted-foreground text-right">AVG PRICE</span>
              <span className="text-xs font-mono text-muted-foreground text-right">SLIPPAGE</span>
              <span className="text-xs font-mono text-muted-foreground text-right">FEE</span>
              <span className="text-xs font-mono text-muted-foreground text-right">NET PROCEEDS</span>
            </div>

            {result.results.map((row, idx) => (
              <VenueRow
                key={row.venue}
                row={row}
                isBest={row.venue === result.bestVenue && row.available}
                rank={idx + 1}
              />
            ))}

            {result.results.length === 0 && (
              <div className="p-8 flex flex-col items-center gap-2">
                <Info className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-mono text-muted-foreground">No venues found for this token. It may not be listed on any supported exchange.</p>
              </div>
            )}
          </div>

          <p className="text-xs font-mono text-muted-foreground text-right">
            Scanned at {new Date(result.scannedAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}

function VenueRow({ row, isBest, rank }: { row: VenueResult; isBest: boolean; rank: number }) {
  return (
    <div
      className={cn(
        "grid grid-cols-6 gap-2 px-4 py-3 border-b border-border/30 last:border-b-0 transition-colors",
        isBest && "bg-primary/5 border-l-2 border-l-primary",
        !row.available && "opacity-50"
      )}
    >
      <div className="col-span-2 flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground w-4">{rank}</span>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono font-medium text-foreground">{row.venue}</span>
            {isBest && (
              <Badge className="text-[10px] font-mono bg-primary/20 text-primary border-primary/30 h-4 px-1">
                BEST
              </Badge>
            )}
            {row.slippagePct > 5 && row.available && (
              <Badge variant="destructive" className="text-[10px] font-mono h-4 px-1">
                HIGH SLIP
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Badge variant="outline" className={cn(
              "text-[10px] font-mono h-4 px-1",
              row.venueType === "dex" ? "border-blue-500/50 text-blue-400" : "border-orange-500/50 text-orange-400"
            )}>
              {row.venueType.toUpperCase()}
            </Badge>
            {row.gasEstimateUsd !== undefined && (
              <span className="text-[10px] font-mono text-muted-foreground/60">gas: {formatUsd(row.gasEstimateUsd)}</span>
            )}
          </div>
        </div>
      </div>

      {row.available ? (
        <>
          <div className="flex items-center justify-end">
            <span className="text-xs font-mono text-foreground">{formatUsd(row.estimatedPrice)}</span>
          </div>
          <div className="flex items-center justify-end">
            <span className={cn(
              "text-xs font-mono font-medium",
              row.slippagePct > 5 ? "text-destructive" :
              row.slippagePct > 2 ? "text-yellow-400" :
              "text-green-400"
            )}>
              {formatPct(row.slippagePct)}
            </span>
          </div>
          <div className="flex items-center justify-end">
            <span className="text-xs font-mono text-muted-foreground">{formatPct(row.feePct)}</span>
          </div>
          <div className="flex items-center justify-end">
            <span className={cn(
              "text-xs font-mono font-bold",
              isBest ? "text-primary" : "text-foreground"
            )}>
              {formatUsd(row.netProceeds)}
            </span>
          </div>
        </>
      ) : (
        <div className="col-span-4 flex items-center justify-end">
          <span className="text-xs font-mono text-muted-foreground/60 italic">
            {row.errorReason || "Not available"}
          </span>
        </div>
      )}
    </div>
  );
}
