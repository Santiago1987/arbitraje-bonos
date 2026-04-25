import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  Bond,
  BondPair,
  PairLiveData,
  PairStatistics,
  AlertEvent,
  AlertConfig,
  StatsWindow,
} from "@arbitraje/shared";

export type WSStatus = "idle" | "connecting" | "connected" | "disconnected";

interface MarketState {
  // Catálogo de bonos (rara vez cambia)
  bonds: Bond[];

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

  // Alertas configuradas (persistidas en backend)
  alertConfigs: AlertConfig[];

  // Conexión
  wsStatus: WSStatus;

  // Carga inicial
  pairsLoading: boolean;
  pairsError: string | null;

  // ---- Actions ----
  setBonds: (bonds: Bond[]) => void;

  setPairs: (pairs: BondPair[], live?: Record<string, PairLiveData>) => void;
  setPairsLoading: (loading: boolean) => void;
  setPairsError: (error: string | null) => void;
  addPair: (pair: BondPair) => void;
  removePair: (id: string) => void;

  updateLive: (data: PairLiveData) => void;

  setStats: (stats: PairStatistics[]) => void;
  setSelectedWindow: (window: StatsWindow) => void;

  addAlert: (alert: AlertEvent) => void;
  removeAlert: (alertId: string, timestamp: Date | string) => void;
  clearAlerts: () => void;

  setAlertConfigs: (configs: AlertConfig[]) => void;
  upsertAlertConfig: (config: AlertConfig) => void;
  removeAlertConfig: (id: string) => void;

  setWsStatus: (status: WSStatus) => void;

  setSelectedPairId: (pairId: string | null) => void;
}

const MAX_ALERTS = 20;

export const useMarketStore = create<MarketState>()(
  immer((set) => ({
    bonds: [],
    pairs: [],
    liveData: {},
    stats: {},
    selectedWindow: "1m",
    selectedPairId: null,
    recentAlerts: [],
    alertConfigs: [],
    wsStatus: "idle",
    pairsLoading: false,
    pairsError: null,

    setBonds: (bonds) =>
      set((state) => {
        state.bonds = bonds;
      }),

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

    addPair: (pair) =>
      set((state) => {
        const idx = state.pairs.findIndex((p) => p.id === pair.id);
        if (idx >= 0) state.pairs[idx] = pair;
        else state.pairs.push(pair);
      }),

    removePair: (id) =>
      set((state) => {
        state.pairs = state.pairs.filter((p) => p.id !== id);
        delete state.liveData[id];
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
        if (state.recentAlerts.find((al) => al.alertId === alert.alertId))
          return;
        state.recentAlerts.unshift(alert);
        if (state.recentAlerts.length > MAX_ALERTS) {
          state.recentAlerts.length = MAX_ALERTS;
        }
      }),

    removeAlert: (alertId, timestamp) =>
      set((state) => {
        const ts = new Date(timestamp).getTime();
        state.recentAlerts = state.recentAlerts.filter(
          (a) =>
            !(a.alertId === alertId && new Date(a.timestamp).getTime() === ts),
        );
      }),

    clearAlerts: () =>
      set((state) => {
        state.recentAlerts = [];
      }),

    setAlertConfigs: (configs) =>
      set((state) => {
        state.alertConfigs = configs;
      }),

    upsertAlertConfig: (config) =>
      set((state) => {
        const idx = state.alertConfigs.findIndex((a) => a.id === config.id);
        if (idx >= 0) state.alertConfigs[idx] = config;
        else state.alertConfigs.unshift(config);
      }),

    removeAlertConfig: (id) =>
      set((state) => {
        state.alertConfigs = state.alertConfigs.filter((a) => a.id !== id);
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
