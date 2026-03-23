import { useGetStats } from "@workspace/api-client-react";
import { Activity, TrendingUp, AlertTriangle, Globe, Layers, DollarSign } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function StatsHeader() {
  const { data: stats, isLoading, isError } = useGetStats({
    query: { refetchInterval: 2000 }
  });

  if (isLoading || isError || !stats) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <Skeleton className="h-4 w-20 mb-2 bg-muted" />
              <Skeleton className="h-8 w-16 bg-muted" />
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
      value: `${stats.maxSpreadPercent.toFixed(2)}%`,
      icon: TrendingUp,
      color: stats.maxSpreadPercent > 2 ? "text-primary" : "text-yellow-400",
      bg: stats.maxSpreadPercent > 2 ? "bg-primary/10" : "bg-yellow-400/10"
    },
    {
      title: "Avg Spread",
      value: `${stats.avgSpreadPercent.toFixed(2)}%`,
      icon: AlertTriangle,
      color: "text-blue-400",
      bg: "bg-blue-400/10"
    },
    {
      title: "Venues Monitored",
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
    }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {items.map((item, i) => (
        <Card key={i} className="bg-card border-border/50 shadow-sm hover:bg-card/80 transition-colors">
          <CardContent className="p-4 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {item.title}
              </span>
              <div className={`p-1.5 rounded-md ${item.bg}`}>
                <item.icon className={`h-4 w-4 ${item.color}`} />
              </div>
            </div>
            <div className={`text-2xl font-mono font-bold ${item.color}`}>
              {item.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
