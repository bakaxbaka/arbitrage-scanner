import { useState } from "react";
import { useGetSpreadHistory } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";

export function SpreadChart() {
  const [pair, setPair] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1h");

  const { data: spreadData, isLoading } = useGetSpreadHistory(
    { pair, timeframe },
    { query: { refetchInterval: 5000 } }
  );

  const formattedData = spreadData?.map(d => ({
    ...d,
    timeFormatted: format(new Date(d.time), "HH:mm"),
  })) || [];

  return (
    <Card className="flex flex-col h-full bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50">
        <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
          Spread History
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={pair} onValueChange={setPair}>
            <SelectTrigger className="w-[120px] h-8 bg-background border-border/50 font-mono text-xs">
              <SelectValue placeholder="Pair" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BTC/USDT">BTC/USDT</SelectItem>
              <SelectItem value="ETH/USDT">ETH/USDT</SelectItem>
              <SelectItem value="SOL/USDT">SOL/USDT</SelectItem>
            </SelectContent>
          </Select>
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-[80px] h-8 bg-background border-border/50 font-mono text-xs">
              <SelectValue placeholder="Time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1m">1 Min</SelectItem>
              <SelectItem value="5m">5 Min</SelectItem>
              <SelectItem value="1h">1 Hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-1 min-h-[300px]">
        {isLoading && !spreadData ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : formattedData.length === 0 ? (
          <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
            NO_HISTORICAL_DATA
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={formattedData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis 
                dataKey="timeFormatted" 
                stroke="hsl(var(--muted-foreground))" 
                fontSize={10}
                tickLine={false}
                axisLine={false}
                fontFamily="Fira Code, monospace"
              />
              <YAxis 
                stroke="hsl(var(--muted-foreground))" 
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(val) => `${val.toFixed(2)}%`}
                fontFamily="Fira Code, monospace"
              />
              <RechartsTooltip 
                contentStyle={{ 
                  backgroundColor: "hsl(var(--popover))", 
                  borderColor: "hsl(var(--border))",
                  borderRadius: "6px",
                  fontFamily: "Fira Code, monospace",
                  fontSize: "12px"
                }}
                itemStyle={{ color: "hsl(var(--primary))" }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: "4px" }}
              />
              <Line 
                type="monotone" 
                dataKey="spread" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "hsl(var(--primary))" }}
                animationDuration={500}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
