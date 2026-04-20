import { useState } from "react";
import { useMarketStore } from "../../store/marketStore";
import BYMAModal from "./BYMAModal";
import Header from "./Header";
import Alerts from "./Alerts";
import BondsTable from "./BondsTable";
import RatioChart from "./RatioChart";

export function Dashboard() {
  const pairs = useMarketStore((s) => s.pairs);
  const loading = useMarketStore((s) => s.pairsLoading);
  const alerts = useMarketStore((s) => s.recentAlerts);

  const [showBymaModal, setShowBymaModal] = useState(false);

  const handleOnClickBymaModal = (show: boolean) => {
    setShowBymaModal(show);
  };

  return (
    <div className="space-y-">
      <Header handleOnClickBymaModal={handleOnClickBymaModal} />
      {alerts.length > 0 && <Alerts alerts={alerts} />}
      <BondsTable loading={loading} pairs={pairs} />
      <RatioChart />
      {showBymaModal && (
        <BYMAModal handleOnClickBymaModal={handleOnClickBymaModal} />
      )}
    </div>
  );
}
