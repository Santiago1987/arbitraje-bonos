import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { StockArbUpdate } from "@arbitraje/shared";

/**
 * Store del arbitraje de acciones CI vs 24hs.
 * Se alimenta exclusivamente del WS (canal "stocks", ver wsClient):
 * cada `stock_arb_update` trae precios de ambas patas, diferencia,
 * valor del pase, ganancia y los parámetros de caución usados.
 */
interface StockArbState {
  // Última actualización por acción — alta frecuencia, indexado por ticker
  rows: Record<string, StockArbUpdate>;

  // Parámetros de caución del último update recibido (todos los mensajes
  // los traen; se separan para mostrarlos una sola vez en la vista)
  tasaCaucion: number | null;
  diasCaucion: number | null;
  costoCaucion: number | null;

  // ---- Actions ----
  updateRow: (update: StockArbUpdate) => void;
  clear: () => void;
}

export const useStockArbStore = create<StockArbState>()(
  immer((set) => ({
    rows: {},
    tasaCaucion: null,
    diasCaucion: null,
    costoCaucion: null,

    updateRow: (update) =>
      set((state) => {
        state.rows[update.ticker] = update;
        state.tasaCaucion = update.tasaCaucion;
        state.diasCaucion = update.diasCaucion;
        state.costoCaucion = update.costoCaucion;
      }),

    clear: () =>
      set((state) => {
        state.rows = {};
        state.tasaCaucion = null;
        state.diasCaucion = null;
        state.costoCaucion = null;
      }),
  })),
);

// ---- Selectores útiles ----

export const selectRowByTicker = (ticker: string) => (state: StockArbState) =>
  state.rows[ticker];

// Campos sueltos (no un objeto) para no forzar re-renders por identidad nueva
export const selectTasaCaucion = (state: StockArbState) => state.tasaCaucion;
export const selectDiasCaucion = (state: StockArbState) => state.diasCaucion;
export const selectCostoCaucion = (state: StockArbState) => state.costoCaucion;
