import { useGetPrices } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search } from "lucide-react";

export function PriceTable() {
  const [search, setSearch] = useState("");
  const { data: prices, isLoading } = useGetPrices({}, { query: { refetchInterval: 2000 } });

  const filteredPrices = prices?.filter(p => 
    p.pair.toLowerCase().includes(search.toLowerCase()) || 
    p.venue.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Card className="flex flex-col h-full bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
          Market Prices
        </CardTitle>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search pair or venue..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-9 bg-background font-mono text-xs border-border/50 focus-visible:ring-primary"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-auto flex-1">
        <Table>
          <TableHeader className="bg-muted/20 sticky top-0 backdrop-blur-sm">
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="font-mono text-xs">Venue</TableHead>
              <TableHead className="font-mono text-xs">Pair</TableHead>
              <TableHead className="font-mono text-xs text-right">Price</TableHead>
              <TableHead className="font-mono text-xs text-right hidden md:table-cell">Bid</TableHead>
              <TableHead className="font-mono text-xs text-right hidden md:table-cell">Ask</TableHead>
              <TableHead className="font-mono text-xs text-right hidden lg:table-cell">Liquidity</TableHead>
              <TableHead className="font-mono text-xs text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && !filteredPrices ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <div className="flex justify-center"><div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
                </TableCell>
              </TableRow>
            ) : !filteredPrices?.length ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center font-mono text-muted-foreground text-xs">
                  NO_MATCHES_FOUND
                </TableCell>
              </TableRow>
            ) : (
              filteredPrices.map((price) => (
                <TableRow key={price.id} className="border-border/20 hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{price.venue}</span>
                      <Badge variant="outline" className="text-[9px] uppercase px-1 py-0 h-4 border-muted-foreground/30 text-muted-foreground hidden sm:inline-flex">
                        {price.source}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono font-bold text-sm">{price.pair}</TableCell>
                  <TableCell className="text-right font-mono text-foreground">${price.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</TableCell>
                  <TableCell className="text-right font-mono text-emerald-400 hidden md:table-cell">{price.bid ? `$${price.bid.toFixed(2)}` : '-'}</TableCell>
                  <TableCell className="text-right font-mono text-destructive hidden md:table-cell">{price.ask ? `$${price.ask.toFixed(2)}` : '-'}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground hidden lg:table-cell">
                    {price.liquidityUsd ? `$${(price.liquidityUsd / 1000).toFixed(1)}k` : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {new Date(price.time).toLocaleTimeString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
