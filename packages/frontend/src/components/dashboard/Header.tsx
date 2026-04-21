import { Plug } from "lucide-react";
import { clsx } from "clsx";
import { useMarketStore, selectIsConnected } from "../../store/marketStore";

interface Props {
  handleOnClickBymaModal: (show: boolean) => void;
}

const Header = ({ handleOnClickBymaModal }: Props) => {
  const isConnected = useMarketStore(selectIsConnected);

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

        <button
          onClick={() => handleOnClickBymaModal(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 transition-colors text-sm"
        >
          <Plug className="w-4 h-4" />
          Conectar BYMA
        </button>
      </div>
    </div>
  );
};

export default Header;
