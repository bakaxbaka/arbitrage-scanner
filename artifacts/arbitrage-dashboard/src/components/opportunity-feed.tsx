import { useGetOpportunities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, AlertCircle, ArrowRight, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const CHAIN_COLORS: Record<string, string> = {
  gate: "border-teal-500/50 text-teal-400",
  binance: "border-yellow-400/50 text-yellow-400",
  bybit: "border-orange-400/50 text-orange-400",
  okx: "border-slate-400/50 text-slate-300",
  kucoin: "border-green-500/50 text-green-400",
  mexc: "border-fuchsia-500/50 text-fuchsia-400",
  kraken: "border-violet-400/50 text-violet-400",
  coinbase: "border-blue-600/50 text-blue-500",
};

function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(4);
  if (p >= 0.0001) return p.toFixed(6);
  return p.toExponential(4);
}

export function OpportunityFeed() {
  const { data: opportunities, isLoading } = useGetOpportunities(
    { activeOnly: true, limit: 20 },
    { query: { refetchInterval: 2000 } }
  );
  const { toast } = useToast();

  const copyToClipboard = (data: any) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast({
      title: "Data Copied",
      description: "Arbitrage trade data copied to clipboard.",
    });
  };

  return (
    <Card className="flex flex-col h-full bg-card border-border/50 overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/50 bg-muted/20">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" />
          Live Opportunities
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground/60">based on $100 USDT</span>
          <Badge variant="outline" className="font-mono text-[10px] border-primary/50 text-primary">
            LIVE_FEED
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0 overflow-auto flex-1 custom-scrollbar">
        {isLoading && !opportunities ? (
          <div className="flex flex-col space-y-2 p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-muted/50 animate-pulse rounded-md" />
            ))}
          </div>
        ) : !opportunities || opportunities.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
            <span className="text-sm font-mono">NO_ARBITRAGE_FOUND</span>
            <span className="text-xs mt-1 opacity-50">Waiting for market inefficiencies...</span>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {opportunities.map((opp) => {
              const buyColor = CHAIN_COLORS[opp.buyVenue] ?? "border-border text-muted-foreground";
              const sellColor = CHAIN_COLORS[opp.sellVenue] ?? "border-border text-muted-foreground";
              const isHot = opp.spreadPercent > 1.0;

              return (
                <div
                  key={opp.id}
                  className={cn(
                    "px-3 py-2.5 group transition-colors hover:bg-muted/20",
                    isHot && "animate-flash-green"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-foreground">{opp.pair}</span>
                        <span className="text-[10px] font-mono text-muted-foreground/50">
                          {format(new Date(opp.detectedAt), "HH:mm:ss")}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className={cn("inline-flex flex-col items-start px-2 py-1 rounded border text-[10px] font-mono", buyColor, "bg-current/5")}>
                          <span className="opacity-60 uppercase text-[9px]">BUY @ {opp.buyVenue}</span>
                          <span className="font-bold text-xs">${formatPrice(opp.buyPrice)}</span>
                        </div>

                        <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />

                        <div className={cn("inline-flex flex-col items-start px-2 py-1 rounded border text-[10px] font-mono", sellColor, "bg-current/5")}>
                          <span className="opacity-60 uppercase text-[9px]">SELL @ {opp.sellVenue}</span>
                          <span className="font-bold text-xs">${formatPrice(opp.sellPrice)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={cn(
                        "font-mono font-bold text-base tabular-nums",
                        isHot ? "text-primary" : "text-emerald-400"
                      )}>
                        {opp.spreadPercent.toFixed(2)}%
                      </span>
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-emerald-500/70" />
                        <span className="text-[11px] font-mono text-emerald-500">
                          ${opp.netProfitUsd.toFixed(3)}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-60 transition-opacity"
                        onClick={() => copyToClipboard(opp)}
                        title="Copy Trade Data"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
