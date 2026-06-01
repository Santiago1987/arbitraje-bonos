import { useEffect, useMemo } from "react";
import { Activity } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import PairRow from "./PairRow";
import type { BondPair } from "@arbitraje/shared";
import { useMarketStore } from "../../store/marketStore";
import { useSettingsStore } from "../../store/settingsStore";
import { fetchPairsSummary } from "../../services/api";

interface Props {
  loading: boolean;
  pairs: BondPair[];
}

const BondsTable = ({ loading, pairs }: Props) => {
  const setSummaries = useMarketStore((s) => s.setSummaries);
  const pairOrder = useSettingsStore((s) => s.settings.pairOrder);
  const setPairOrder = useSettingsStore((s) => s.setPairOrder);

  useEffect(() => {
    if (pairs.length === 0) return;
    fetchPairsSummary()
      .then(setSummaries)
      .catch(() => {});
  }, [pairs.length, setSummaries]);

  // Orden custom: los pares presentes en pairOrder van primero según ese índice;
  // los no presentes (recién creados) quedan al final en su orden natural.
  const orderedPairs = useMemo(() => {
    if (!pairOrder || pairOrder.length === 0) return pairs;
    const indexOf = new Map(pairOrder.map((id, i) => [id, i]));
    return [...pairs].sort((a, b) => {
      const ia = indexOf.get(a.id) ?? Infinity;
      const ib = indexOf.get(b.id) ?? Infinity;
      return ia - ib;
    });
  }, [pairs, pairOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = orderedPairs.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    setPairOrder(arrayMove(ids, oldIndex, newIndex));
  };

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
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedPairs.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                {orderedPairs.map((pair) => (
                  <PairRow key={pair.id} pair={pair} />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
};

export default BondsTable;
