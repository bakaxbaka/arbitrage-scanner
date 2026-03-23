import React from "react";
import { Activity, LayoutDashboard, Settings, RefreshCcw } from "lucide-react";
import { useWebSocket } from "../hooks/use-websocket";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { status } = useWebSocket();

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground dark">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 max-w-[1600px] mx-auto items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-primary">
              <Activity className="h-5 w-5" />
              <span className="font-mono font-bold tracking-tight hidden sm:inline-block">
                ARB_SCANNER<span className="text-muted-foreground">::V1</span>
              </span>
            </div>
            
            <nav className="flex items-center space-x-1">
              <a href="#" className="px-3 py-2 text-sm font-medium transition-colors hover:text-primary text-primary bg-primary/10 rounded-md flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </a>
              <a href="#" className="px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </a>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-muted-foreground">DATA_FEED:</span>
              <Badge 
                variant="outline" 
                className={cn(
                  "font-mono uppercase",
                  status === "connected" ? "border-primary text-primary bg-primary/10" :
                  status === "connecting" ? "border-yellow-500 text-yellow-500 bg-yellow-500/10 animate-pulse" :
                  "border-destructive text-destructive bg-destructive/10"
                )}
              >
                {status === "connected" && <RefreshCcw className="h-3 w-3 mr-1 animate-spin-slow" />}
                {status}
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 container max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
