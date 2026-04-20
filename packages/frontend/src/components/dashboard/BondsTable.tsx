import { Activity } from "lucide-react";
import clsx from "clsx";
import type { BondPair } from "@arbitraje/shared";
import {
  useMarketStore,
  selectLiveByPair,
  selectStatsByPair,
} from "../../store/marketStore";

interface Props {
  loading: boolean;
  pairs: BondPair[];
}

const BondsTable = ({ loading, pairs }: Props) => {
  return (
    <div className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th colSpan={8} className="p-0">
                <div className="grid grid-cols-6 gap-1">
                  <div className="card rounded-t-lg" />
                  <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
                    Una Semana
                  </div>
                  <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
                    Dos Semanas
                  </div>
                  <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
                    Un Mes
                  </div>
                  <div className="card rounded-t-lg" />
                  <div className="card rounded-t-lg" />
                </div>
                <div className="grid grid-cols-6 gap-1">
                  <div className="grid grid-cols-2 items-center bg-surface-1/40">
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Ratios
                    </div>
                    <div className="text-center py-1 px-1 items-center text-muted font-medium">
                      Ultimo Ratio
                    </div>
                  </div>
                  <div className="grid grid-cols-2 items-center bg-surface-1/40">
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Promedio
                    </div>
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Diferencia
                    </div>
                  </div>
                  <div className="grid grid-cols-2 items-center bg-surface-1/40">
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Promedio
                    </div>
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Diferencia
                    </div>
                  </div>
                  <div className="grid grid-cols-2 items-center bg-surface-1/40">
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Promedio
                    </div>
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Diferencia
                    </div>
                  </div>
                  <div className="grid grid-cols-2 items-center bg-surface-1/40">
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Minimo Mensual
                    </div>
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Diferencia
                    </div>
                  </div>
                  <div className="grid grid-cols-2 items-center bg-surface-1/40">
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Maximo Mensual
                    </div>
                    <div className="text-center py-1 px-1 text-muted font-medium">
                      Diferencia
                    </div>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted">
                  <Activity className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Cargando datos...
                </td>
              </tr>
            ) : pairs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-muted">
                  No hay pares configurados
                </td>
              </tr>
            ) : (
              pairs.map((pair) => <PairRow key={pair.id} pair={pair} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

interface PairRowProps {
  pair: BondPair;
}

const PairRow = ({ pair }: PairRowProps) => {
  // Selectores granulares: esta fila solo re-renderiza cuando cambia SU par
  const live = useMarketStore(selectLiveByPair(pair.id));
  const stats = useMarketStore(selectStatsByPair(pair.id));
  const isSelected = useMarketStore((s) => s.selectedPairId === pair.id);
  const setSelectedPairId = useMarketStore((s) => s.setSelectedPairId);

  return (
    <tr>
      <div className="grid grid-cols-6 gap-1">
        <div
          onClick={() => setSelectedPairId(pair.id)}
          className={clsx(
            "card p-1 grid grid-cols-2 border-b border-surface-3/20 hover:bg-surface-2/50 transition-colors cursor-pointer",
            isSelected
              ? "bg-accent-blue/10 ring-1 ring-accent-blue/40"
              : "bg-surface-1/40",
          )}
        >
          <div className="flex items-center justify-center font-semibold text-center text-base font-mono">
            {pair.name}
          </div>
          <div className="flex items-center justify-end text-white text-lg text-bold text-right">
            {live?.currentRatio?.toFixed(5)}
          </div>
        </div>
      </div>
    </tr>
  );
};

export default BondsTable;
