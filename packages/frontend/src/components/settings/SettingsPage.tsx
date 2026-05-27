import { useState, type ReactElement } from "react";
import clsx from "clsx";
import { LineChart } from "lucide-react";
import { RatioChartSection } from "./sections/RatioChartSection";

type SectionId = "ratio-chart";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: typeof LineChart;
  render: () => ReactElement;
}

const SECTIONS: SectionDef[] = [
  {
    id: "ratio-chart",
    label: "Gráfico de Ratio",
    icon: LineChart,
    render: () => <RatioChartSection />,
  },
];

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>("ratio-chart");
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div className="flex flex-row gap-6 h-full">
      <aside className="w-56 shrink-0 flex flex-col gap-1">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded text-sm text-left transition-colors",
                isActive
                  ? "bg-surface-2 text-accent-cyan"
                  : "text-muted hover:bg-surface-2 hover:text-gray-100",
              )}
            >
              <Icon size={16} />
              {s.label}
            </button>
          );
        })}
      </aside>

      <main className="flex-1 min-w-0 overflow-auto pb-8">
        {current.render()}
      </main>
    </div>
  );
}
