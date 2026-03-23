import { Layout } from "@/components/layout";
import { StatsHeader } from "@/components/stats-header";
import { SpreadMatrix } from "@/components/spread-matrix";
import { OpportunityFeed } from "@/components/opportunity-feed";
import { PriceTable } from "@/components/price-table";
import { SpreadChart } from "@/components/spread-chart";

export function Dashboard() {
  return (
    <Layout>
      <div className="flex flex-col gap-6 animate-in fade-in duration-500">
        
        {/* Top Stats Row */}
        <section>
          <StatsHeader />
        </section>

        {/* Middle Row: Spread Matrix & History Chart */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[400px]">
          <SpreadMatrix />
          <SpreadChart />
        </section>

        {/* Bottom Row: Live Feed & Full Price Table */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-[600px]">
          <div className="xl:col-span-1 h-full">
            <OpportunityFeed />
          </div>
          <div className="xl:col-span-2 h-full">
            <PriceTable />
          </div>
        </section>

      </div>
    </Layout>
  );
}
