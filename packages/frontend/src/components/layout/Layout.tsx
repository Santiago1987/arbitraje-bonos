import { NavLink, Outlet } from "react-router-dom";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  LineChart,
  LayoutGrid,
  Bell,
  Settings,
  Activity,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/charts", icon: LineChart, label: "Gráficos" },
  { to: "/multicharts", icon: LayoutGrid, label: "MultiCharts" },
  { to: "/alerts", icon: Bell, label: "Alertas" },
  { to: "/settings", icon: Settings, label: "Configuración" },
];

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Sidebar */}
      <aside className="w-full h-16 bg-surface-1 border-r border-surface-3/30 flex shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 border-b border-surface-3/30">
          <Activity className="w-6 h-6 text-accent-cyan shrink-0" />
          <span className="font-bold text-lg hidden lg:block tracking-tight">
            ArbBonos
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex w-full py-4 px-2 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }: { isActive: boolean }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
                  isActive
                    ? "bg-accent-blue/10 text-accent-blue"
                    : "text-muted hover:text-white hover:bg-surface-2",
                )
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span className="hidden lg:block">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-4 h-16 border-t border-surface-3/30">
          <div className="text-xs text-muted hidden lg:block">
            Arbitraje Bonos v1.0
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="w-full mx-auto h-[calc(100dvh-4.5rem)]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
