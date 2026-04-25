import { useEffect, useState } from "react";
import { useMarketStore } from "../../store/marketStore";
import { fetchAlerts } from "../../services/api";
import BYMAModal from "./BYMAModal";
import Header from "./Header";
import Alerts from "./Alerts";
import BondsTable from "./BondsTable";
import RatioChart from "./RatioChart";
import RightSidebar, { type ActivePanel } from "./RightSidebar";
import AlertsPanel from "./AlertsPanel";
import PairsPanel from "./PairsPanel";

export function Dashboard() {
  const pairs = useMarketStore((s) => s.pairs);
  const loading = useMarketStore((s) => s.pairsLoading);
  const alerts = useMarketStore((s) => s.recentAlerts);
  const setAlertConfigs = useMarketStore((s) => s.setAlertConfigs);

  const [showBymaModal, setShowBymaModal] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  useEffect(() => {
    fetchAlerts()
      .then(setAlertConfigs)
      .catch(() => {});
  }, [setAlertConfigs]);

  const handleOnClickBymaModal = (show: boolean) => {
    setShowBymaModal(show);
  };

  const togglePanel = (panel: Exclude<ActivePanel, null>) =>
    setActivePanel((curr) => (curr === panel ? null : panel));

  return (
    <div className="relative flex h-full">
      <div className="flex-1 space-y-4 p-2">
        <Header handleOnClickBymaModal={handleOnClickBymaModal} />
        {alerts.length > 0 && <Alerts alerts={alerts} />}
        <BondsTable loading={loading} pairs={pairs} />
        <RatioChart />
        {showBymaModal && (
          <BYMAModal handleOnClickBymaModal={handleOnClickBymaModal} />
        )}
      </div>

      <RightSidebar
        activePanel={activePanel}
        onOpenAlerts={() => togglePanel("alerts")}
        onOpenPairs={() => togglePanel("pairs")}
      />

      <AlertsPanel
        open={activePanel === "alerts"}
        onClose={() => setActivePanel(null)}
      />
      <PairsPanel
        open={activePanel === "pairs"}
        onClose={() => setActivePanel(null)}
      />
    </div>
  );
}
