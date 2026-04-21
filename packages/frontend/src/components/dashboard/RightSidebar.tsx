import { Bell } from "lucide-react";
import clsx from "clsx";
import { useMarketStore } from "../../store/marketStore";

interface Props {
  onOpenAlerts: () => void;
  alertsOpen: boolean;
}

const RightSidebar = ({ onOpenAlerts, alertsOpen }: Props) => {
  const recentAlerts = useMarketStore((s) => s.recentAlerts);
  const hasUnseen = recentAlerts.length > 0;

  return (
    <aside className="w-12 shrink-0 bg-surface-1 border-l border-surface-3/30 flex flex-col items-center py-3 gap-2">
      <button
        onClick={onOpenAlerts}
        className={clsx(
          "relative p-2 rounded-lg transition-colors",
          alertsOpen
            ? "bg-accent-blue/15 text-accent-blue"
            : "text-muted hover:text-white hover:bg-surface-2",
        )}
        aria-label="Alertas"
        title="Alertas"
      >
        <Bell className="w-5 h-5" />
        {hasUnseen && !alertsOpen && (
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-accent-amber" />
        )}
      </button>
    </aside>
  );
};

export default RightSidebar;
