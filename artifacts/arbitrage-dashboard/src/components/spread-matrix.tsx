import React, { useState } from "react";
import { useGetPrices } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function SpreadMatrix() {
  const [selectedPair, setSelectedPair] = useState("BTC/USDT");
  
  // We pull all prices but filter manually or let API filter if it supports it
  // Since we want to build a matrix, we need all venues for a specific pair
  const { data: prices, isLoading } = useGetPrices(
    { pair: selectedPair },
    { query: { refetchInterval: 2000 } }
  );

  const venues = Array.from(new Set(prices?.map(p => p.venue) || [])).sort();

  // Helper to find price for a venue
  const getPrice = (venue: string) => prices?.find(p => p.venue === venue)?.price;

  return (
    <Card className="flex flex-col h-full bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
          Spread Matrix
        </CardTitle>
        <Select value={selectedPair} onValueChange={setSelectedPair}>
          <SelectTrigger className="w-[140px] h-8 bg-background border-border/50 font-mono text-xs">
            <SelectValue placeholder="Select Pair" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BTC/USDT">BTC/USDT</SelectItem>
            <SelectItem value="ETH/USDT">ETH/USDT</SelectItem>
            <SelectItem value="SOL/USDT">SOL/USDT</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="p-0 overflow-auto flex-1">
        {isLoading && !prices ? (
          <div className="flex h-full items-center justify-center p-8 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : venues.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground font-mono">
            NO_DATA_AVAILABLE
          </div>
        ) : (
          <div className="min-w-max p-4">
            <div 
              className="grid gap-1"
              style={{ gridTemplateColumns: `auto repeat(${venues.length}, minmax(80px, 1fr))` }}
            >
              {/* Header Row */}
              <div className="p-2"></div>
              {venues.map(v => (
                <div key={v} className="p-2 text-center text-xs font-mono font-bold text-muted-foreground truncate">
                  {v}
                </div>
              ))}

              {/* Body Rows */}
              {venues.map(rowVenue => {
                const rowPrice = getPrice(rowVenue);
                return (
                  <React.Fragment key={rowVenue}>
                    {/* Row Header */}
                    <div className="p-2 flex items-center justify-end text-xs font-mono font-bold text-muted-foreground border-r border-border/50 truncate">
                      {rowVenue}
                    </div>
                    
                    {/* Cells */}
                    {venues.map(colVenue => {
                      const colPrice = getPrice(colVenue);
                      
                      if (!rowPrice || !colPrice || rowVenue === colVenue) {
                        return (
                          <div key={colVenue} className="p-2 text-center text-xs font-mono bg-background/50 text-muted-foreground/30 border border-border/30 rounded flex items-center justify-center">
                            -
                          </div>
                        );
                      }

                      // Spread: buying at rowVenue, selling at colVenue
                      const spread = ((colPrice - rowPrice) / rowPrice) * 100;
                      const isPositive = spread > 0.1;
                      const isNegative = spread < -0.1;

                      return (
                        <div 
                          key={colVenue} 
                          className={cn(
                            "p-2 text-center text-xs font-mono border rounded flex flex-col items-center justify-center transition-colors",
                            isPositive ? "bg-primary/10 border-primary/30 text-primary" : 
                            isNegative ? "bg-destructive/10 border-destructive/30 text-destructive" : 
                            "bg-background/50 border-border/30 text-muted-foreground"
                          )}
                        >
                          <span className="font-semibold">
                            {spread > 0 ? "+" : ""}{spread.toFixed(2)}%
                          </span>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
