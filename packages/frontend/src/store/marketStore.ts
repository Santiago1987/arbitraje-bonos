import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  BondPair,
  PairLiveData,
  PairStatistics,
  AlertEvent,
  StatsWindow,
} from "@arbitraje/shared";

export type WSStatus = "idle" | "connecting" | "connected" | "disconnected";

interface MarketState {
  // Metadata (rara vez cambia)
  pairs: BondPair[];

  // Alta frecuencia — indexado por pairId
  liveData: Record<string, PairLiveData>;

  // Baja frecuencia — indexado por pairId
  stats: Record<string, PairStatistics>;
  selectedWindow: StatsWindow;

  // Par seleccionado (para vista de gráfico, etc.)
  selectedPairId: string | null;

  // Alertas recientes (buffer circular)
  recentAlerts: AlertEvent[];

  // Conexión
  wsStatus: WSStatus;

  // Carga inicial
  pairsLoading: boolean;
  pairsError: string | null;

  // ---- Actions ----
  setPairs: (pairs: BondPair[], live?: Record<string, PairLiveData>) => void;
  setPairsLoading: (loading: boolean) => void;
  setPairsError: (error: string | null) => void;

  updateLive: (data: PairLiveData) => void;

  setStats: (stats: PairStatistics[]) => void;
  setSelectedWindow: (window: StatsWindow) => void;

  addAlert: (alert: AlertEvent) => void;
  clearAlerts: () => void;

  setWsStatus: (status: WSStatus) => void;

  setSelectedPairId: (pairId: string | null) => void;
}

const MAX_ALERTS = 20;

export const useMarketStore = create<MarketState>()(
  immer((set) => ({
    pairs: [],
    liveData: {},
    stats: {},
    selectedWindow: "1m",
    selectedPairId: null,
    recentAlerts: [],
    wsStatus: "idle",
    pairsLoading: false,
    pairsError: null,

    setPairs: (pairs, live) =>
      set((state) => {
        state.pairs = pairs;
        if (live) state.liveData = live;
      }),

    setPairsLoading: (loading) =>
      set((state) => {
        state.pairsLoading = loading;
      }),

    setPairsError: (error) =>
      set((state) => {
        state.pairsError = error;
      }),

    updateLive: (data) =>
      set((state) => {
        state.liveData[data.pairId] = data;
      }),

    setStats: (stats) =>
      set((state) => {
        state.stats = {};
        for (const s of stats) state.stats[s.pairId] = s;
      }),

    setSelectedWindow: (window) =>
      set((state) => {
        state.selectedWindow = window;
      }),

    addAlert: (alert) =>
      set((state) => {
        state.recentAlerts.unshift(alert);
        if (state.recentAlerts.length > MAX_ALERTS) {
          state.recentAlerts.length = MAX_ALERTS;
        }
      }),

    clearAlerts: () =>
      set((state) => {
        state.recentAlerts = [];
      }),

    setWsStatus: (status) =>
      set((state) => {
        state.wsStatus = status;
      }),

    setSelectedPairId: (pairId) =>
      set((state) => {
        state.selectedPairId = pairId;
      }),
  })),
);

// ---- Selectores útiles ----

export const selectLiveByPair = (pairId: string) => (state: MarketState) =>
  state.liveData[pairId];

export const selectStatsByPair = (pairId: string) => (state: MarketState) =>
  state.stats[pairId];

export const selectIsConnected = (state: MarketState) =>
  state.wsStatus === "connected";
