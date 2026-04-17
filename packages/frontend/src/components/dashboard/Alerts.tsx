import { Bell } from "lucide-react";
import type { AlertEvent } from "@arbitraje/shared";

interface Props {
  alerts: AlertEvent[];
}

const Alerts = ({ alerts }: Props) => {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Bell className="w-4 h-4 text-accent-amber" />
        <span className="text-sm font-medium">Alertas recientes</span>
      </div>
      <div className="space-y-2">
        {alerts.slice(0, 3).map((alert, i) => (
          <div
            key={`${alert.alertId}-${i}`}
            className="flex items-center justify-between text-sm bg-accent-amber/5 border border-accent-amber/20 rounded-lg px-3 py-2"
          >
            <span>{alert.message}</span>
            <span className="text-muted text-xs">
              {new Date(alert.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Alerts;
