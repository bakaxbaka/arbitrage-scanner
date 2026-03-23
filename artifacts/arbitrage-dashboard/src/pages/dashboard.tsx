import { useState } from "react";
import { Layout } from "@/components/layout";
import { StatsHeader } from "@/components/stats-header";
import { SpreadMatrix } from "@/components/spread-matrix";
import { OpportunityFeed } from "@/components/opportunity-feed";
import { PriceTable } from "@/components/price-table";
import { SpreadChart } from "@/components/spread-chart";
import { ExitOptimizer } from "@/components/exit-optimizer";
import { LayoutDashboard, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "dashboard" | "exit-optimizer";

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === "dashboard" && (
        <div className="flex flex-col gap-6 animate-in fade-in duration-500">
          <section>
            <StatsHeader />
          </section>
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[400px]">
            <SpreadMatrix />
            <SpreadChart />
          </section>
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-[600px]">
            <div className="xl:col-span-1 h-full">
              <OpportunityFeed />
            </div>
            <div className="xl:col-span-2 h-full">
              <PriceTable />
            </div>
          </section>
        </div>
      )}

      {activeTab === "exit-optimizer" && (
        <div className="animate-in fade-in duration-500">
          <ExitOptimizer />
        </div>
      )}
    </Layout>
  );
}
