import React from "react";
import { useGetStats } from "@workspace/api-client-react";
import { Activity, TrendingUp, AlertTriangle, Globe, Layers, DollarSign, BarChart2, Link } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function StatsHeader() {
  const { data: rawStats, isLoading, isError } = useGetStats({
    query: { refetchInterval: 3000 }
  });

  const stats = rawStats as (typeof rawStats & {
    scannedTokens?: number;
    scannedChains?: number;
    chainsActive?: string[];
    gatePairCount?: number;
  }) | undefined;

  if (isLoading || isError || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <Skeleton className="h-3 w-16 mb-2 bg-muted" />
              <Skeleton className="h-7 w-14 bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const items = [
    {
      title: "Active Opps",
      value: stats.activeOpportunities,
      icon: Activity,
      color: "text-primary",
      bg: "bg-primary/10"
    },
    {
      title: "Total Profit (24h)",
      value: `$${stats.totalProfitUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: DollarSign,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10"
    },
    {
      title: "Max Spread",
      value: `${(stats.maxSpreadPercent ?? 0).toFixed(2)}%`,
      icon: TrendingUp,
      color: (stats.maxSpreadPercent ?? 0) > 2 ? "text-primary" : "text-yellow-400",
      bg: (stats.maxSpreadPercent ?? 0) > 2 ? "bg-primary/10" : "bg-yellow-400/10"
    },
    {
      title: "Avg Spread",
      value: `${(stats.avgSpreadPercent ?? 0).toFixed(2)}%`,
      icon: AlertTriangle,
      color: "text-blue-400",
      bg: "bg-blue-400/10"
    },
    {
      title: "Venues",
      value: stats.venuesMonitored,
      icon: Globe,
      color: "text-purple-400",
      bg: "bg-purple-400/10"
    },
    {
      title: "Pairs Tracked",
      value: stats.pairsMonitored,
      icon: Layers,
      color: "text-pink-400",
      bg: "bg-pink-400/10"
    },
    {
      title: "Gate.io Listed",
      value: stats.gatePairCount ?? "…",
      icon: BarChart2,
      color: "text-cyan-400",
      bg: "bg-cyan-400/10"
    },
    {
      title: "Chains Active",
      value: stats.scannedChains ?? 7,
      icon: Link,
      color: "text-orange-400",
      bg: "bg-orange-400/10"
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
      {items.map((item, i) => (
        <Card key={i} className="bg-card border-border/50 shadow-sm hover:bg-card/80 transition-colors">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-tight">
                {item.title}
              </span>
              <div className={`p-1 rounded-md ${item.bg}`}>
                <item.icon className={`h-3 w-3 ${item.color}`} />
              </div>
            </div>
            <div className={`text-xl font-mono font-bold ${item.color}`}>
              {item.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
