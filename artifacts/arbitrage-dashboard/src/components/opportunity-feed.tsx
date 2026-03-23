import { useGetOpportunities } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, AlertCircle, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export function OpportunityFeed() {
  const { data: opportunities, isLoading } = useGetOpportunities(
    { activeOnly: true, limit: 10 },
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
      <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50 bg-muted/20">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-primary" />
          Live Opportunities
        </CardTitle>
        <Badge variant="outline" className="font-mono text-[10px] border-primary/50 text-primary">
          LIVE_FEED
        </Badge>
      </CardHeader>
      
      <CardContent className="p-0 overflow-auto flex-1 custom-scrollbar">
        {isLoading && !opportunities ? (
          <div className="flex flex-col space-y-2 p-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-muted/50 animate-pulse rounded-md" />
            ))}
          </div>
        ) : !opportunities || opportunities.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
            <span className="text-sm font-mono">NO_ARBITRAGE_FOUND</span>
            <span className="text-xs mt-1 opacity-50">Waiting for market inefficiencies...</span>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {opportunities.map((opp) => (
              <div 
                key={opp.id} 
                className={cn(
                  "p-4 flex items-center justify-between group transition-colors hover:bg-muted/30",
                  opp.spreadPercent > 1.0 && "animate-flash-green"
                )}
              >
                <div className="flex items-center gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono font-bold text-sm text-foreground">{opp.pair}</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {format(new Date(opp.detectedAt), "HH:mm:ss.SSS")}
                    </span>
                  </div>

                  <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-background/50 rounded-lg border border-border/50">
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-mono text-muted-foreground">{opp.buySource}</span>
                      <span className="text-sm font-semibold">{opp.buyVenue}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col items-start">
                      <span className="text-xs font-mono text-muted-foreground">{opp.sellSource}</span>
                      <span className="text-sm font-semibold">{opp.sellVenue}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="flex flex-col items-end">
                    <span className={cn(
                      "font-mono font-bold text-lg",
                      opp.spreadPercent > 1.0 ? "text-primary" : "text-emerald-400"
                    )}>
                      {opp.spreadPercent.toFixed(2)}%
                    </span>
                    <span className="text-xs font-mono text-emerald-500/70">
                      Est. Profit: ${opp.profitUsd.toFixed(2)}
                    </span>
                  </div>
                  
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyToClipboard(opp)}
                    title="Copy Trade Data"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
