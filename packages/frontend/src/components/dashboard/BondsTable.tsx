import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import PairRow from "./PairRow";
import type { BondPair } from "@arbitraje/shared";
import {
  useMarketStore,
  selectLiveByPair,
  selectSummaryByPair,
} from "../../store/marketStore";
import { fetchPairsSummary } from "../../services/api";

interface Props {
  loading: boolean;
  pairs: BondPair[];
}

const BondsTable = ({ loading, pairs }: Props) => {
  const setSummaries = useMarketStore((s) => s.setSummaries);

  useEffect(() => {
    if (pairs.length === 0) return;
    fetchPairsSummary()
      .then(setSummaries)
      .catch(() => {});
  }, [pairs.length, setSummaries]);

  return (
    <div className="overflow-hidden">
      <div className="overflow-x-auto">
        <div className="w-full text-sm">
          <div className="grid grid-cols-6 gap-1">
            <div className="card rounded-t-lg" />
            <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
              Rueda Anterior
            </div>
            <div className="card text-center py-1 text-muted font-medium text-xs uppercase tracking-wider rounded-t-lg">
              Una Semana
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
          {loading ? (
            <div className="py-12 text-center text-muted">
              <Activity className="w-5 h-5 animate-spin mx-auto mb-2" />
              Cargando datos...
            </div>
          ) : pairs.length === 0 ? (
            <div className="py-12 text-center text-muted">
              No hay pares configurados
            </div>
          ) : (
            pairs.map((pair) => <PairRow key={pair.id} pair={pair} />)
          )}
        </div>
      </div>
    </div>
  );
};

export default BondsTable;
