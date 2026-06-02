import { Bell, X } from "lucide-react";
import type { AlertEvent } from "@arbitraje/shared";
import { useMarketStore } from "../../store/marketStore";

interface Props {
  alerts: AlertEvent[];
}

const Alerts = ({ alerts }: Props) => {
  const removeAlert = useMarketStore((s) => s.removeAlert);

  const visible = alerts.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 z-20 w-full max-w-md -translate-x-1/2 px-4">
      <div className="pointer-events-auto card p-4 shadow-2xl">
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-accent-amber" />
          <span className="text-sm font-medium">Alertas recientes</span>
        </div>
        <div className="space-y-2">
          {visible.map((alert) => (
            <div
              key={`${alert.alertId}-${new Date(alert.timestamp).getTime()}`}
              className="flex items-center justify-between gap-2 text-sm bg-accent-amber/5 border border-accent-amber/20 rounded-lg px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate">{alert.message}</span>
              <span className="text-muted text-xs whitespace-nowrap">
                {new Date(alert.timestamp).toLocaleTimeString()}
              </span>
              <button
                onClick={() => removeAlert(alert.alertId, alert.timestamp)}
                className="p-1 rounded-md hover:bg-accent-red/20 text-muted hover:text-accent-red transition-colors"
                aria-label="Descartar alerta"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Alerts;
