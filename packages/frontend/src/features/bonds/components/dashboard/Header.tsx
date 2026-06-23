import { useState } from "react";
import { Plug, PlugZap } from "lucide-react";
import { clsx } from "clsx";
import { useMarketStore, selectIsConnected } from "../../store/marketStore";
import { disconnectByma } from "../../services/api";

interface Props {
  handleOnClickBymaModal: (show: boolean) => void;
}

const Header = ({ handleOnClickBymaModal }: Props) => {
  const isConnected = useMarketStore(selectIsConnected);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectByma();
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">DASHBOARD</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <div
            className={clsx(
              "w-2 h-2 rounded-full",
              isConnected ? "bg-accent-green animate-pulse" : "bg-accent-red",
            )}
          />
          <span className="text-muted">
            {isConnected ? "Live" : "Desconectado"}
          </span>
        </div>

        {isConnected ? (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 hover:bg-accent-red/20 hover:text-accent-red disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            <PlugZap className="w-4 h-4" />
            {disconnecting ? "Desconectando..." : "Desconectar"}
          </button>
        ) : (
          <button
            onClick={() => handleOnClickBymaModal(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-sm"
          >
            <Plug className="w-4 h-4" />
            Conectar BYMA
          </button>
        )}
      </div>
    </div>
  );
};

export default Header;
