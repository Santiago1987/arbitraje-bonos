import { NavLink, Outlet, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  LineChart,
  LayoutGrid,
  Bell,
  Settings,
  Activity,
  Sigma,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}

// Cada sección es un dominio independiente con su propio menú.
const SECTIONS = {
  bonos: {
    label: "Bonos",
    icon: Activity,
    /** Prefijo que identifica las rutas de la sección. "/" => raíz (bonos). */
    match: (path: string) => !path.startsWith("/opciones"),
    items: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
      { to: "/charts", icon: LineChart, label: "Gráficos" },
      { to: "/multicharts", icon: LayoutGrid, label: "MultiCharts" },
      { to: "/settings", icon: Settings, label: "Configuración" },
    ] as NavItem[],
  },
  opciones: {
    label: "Opciones",
    icon: Sigma,
    match: (path: string) => path.startsWith("/opciones"),
    items: [
      { to: "/opciones", icon: LayoutDashboard, label: "Simulador", end: true },
    ] as NavItem[],
  },
} as const;

type SectionKey = keyof typeof SECTIONS;
const SECTION_ROOT: Record<SectionKey, string> = {
  bonos: "/",
  opciones: "/opciones",
};

export function Layout() {
  const { pathname } = useLocation();
  const activeSection: SectionKey = SECTIONS.opciones.match(pathname)
    ? "opciones"
    : "bonos";
  const nav = SECTIONS[activeSection].items;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Topbar */}
      <aside className="w-full h-16 bg-surface-1 border-b border-surface-3/30 flex shrink-0 items-center">
        <h1 className="text-lg font-bold px-4">
          Vikingo Bursatil - Probando deployar
        </h1>
        {/* Switch de sección */}
        <div className="flex items-center gap-1 px-3 border-r border-surface-3/30 h-full">
          {(Object.keys(SECTIONS) as SectionKey[]).map((key) => {
            const s = SECTIONS[key];
            const isActive = key === activeSection;
            return (
              <NavLink
                key={key}
                to={SECTION_ROOT[key]}
                className={clsx(
                  "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors",
                  isActive
                    ? "bg-accent-cyan/10 text-accent-cyan"
                    : "text-muted hover:text-white hover:bg-surface-2",
                )}
              >
                <s.icon className="w-5 h-5 shrink-0" />
                <span className="hidden lg:block">{s.label}</span>
              </NavLink>
            );
          })}
        </div>

        {/* Navegación de la sección activa */}
        <nav className="flex gap-1 py-4 px-2">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
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

        <div className="ml-auto px-4 text-xs text-muted hidden lg:block">
          build {__COMMIT_HASH__}
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
