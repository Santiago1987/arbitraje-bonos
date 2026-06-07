import { useEffect, useState } from "react";
import { useMarketStore } from "../../store/marketStore";
import { fetchAlerts, fetchOpenExercisePairIds } from "../../services/api";
import BYMAModal from "./BYMAModal";
import Header from "./Header";
import Alerts from "./Alerts";
import BondsTable from "./BondsTable";
import RatioChart from "./RatioChart";
import RightSidebar, { type ActivePanel } from "./RightSidebar";
import AlertsPanel from "./AlertsPanel";
import PairsPanel from "./PairsPanel";
import OperationsPanel from "./OperationsPanel";

export function Dashboard() {
  const pairs = useMarketStore((s) => s.pairs);
  const loading = useMarketStore((s) => s.pairsLoading);
  const alerts = useMarketStore((s) => s.recentAlerts);
  const setAlertConfigs = useMarketStore((s) => s.setAlertConfigs);
  const setOpenExercisePairIds = useMarketStore(
    (s) => s.setOpenExercisePairIds,
  );
  const selectedPairId = useMarketStore((s) => s.selectedPairId);

  const [showBymaModal, setShowBymaModal] = useState(false);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  useEffect(() => {
    fetchAlerts()
      .then(setAlertConfigs)
      .catch(() => {});
  }, [setAlertConfigs]);

  useEffect(() => {
    fetchOpenExercisePairIds()
      .then(setOpenExercisePairIds)
      .catch(() => {});
  }, [setOpenExercisePairIds]);

  const handleOnClickBymaModal = (show: boolean) => {
    setShowBymaModal(show);
  };

  const togglePanel = (panel: Exclude<ActivePanel, null>) =>
    setActivePanel((curr) => (curr === panel ? null : panel));

  return (
    <div className="relative flex h-full">
      <div className="flex flex-col p-2 gap-2 w-full">
        <div className="">
          <Header handleOnClickBymaModal={handleOnClickBymaModal} />
        </div>

        <div className="">
          <BondsTable loading={loading} pairs={pairs} />
        </div>
        <div className="">
          <RatioChart />
          {showBymaModal && (
            <BYMAModal handleOnClickBymaModal={handleOnClickBymaModal} />
          )}
        </div>
      </div>
      {alerts.length > 0 && <Alerts alerts={alerts} />}

      <RightSidebar
        activePanel={activePanel}
        onOpenAlerts={() => togglePanel("alerts")}
        onOpenPairs={() => togglePanel("pairs")}
        onOpenOperations={() => togglePanel("operations")}
      />

      <AlertsPanel
        open={activePanel === "alerts"}
        onClose={() => setActivePanel(null)}
      />
      <PairsPanel
        open={activePanel === "pairs"}
        onClose={() => setActivePanel(null)}
      />
      <OperationsPanel
        open={activePanel === "operations"}
        pairId={selectedPairId}
        onClose={() => setActivePanel(null)}
      />
    </div>
  );
}
