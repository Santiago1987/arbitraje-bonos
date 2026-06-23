import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  Bond,
  BondPair,
  PairLiveData,
  PairStatistics,
  PairSummary,
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

  // Referencias por par (avg/min/max) — se calcula 1× por rueda
  summary: Record<string, PairSummary>;

  // Par seleccionado (para vista de gráfico, etc.)
  selectedPairId: string | null;

  // pairIds con un ejercicio de arbitraje abierto (indicador en la tabla)
  openExercisePairIds: string[];

  // Alertas recientes (buffer circular)
  recentAlerts: AlertEvent[];

  // Alertas configuradas (persistidas en backend)
  alertConfigs: AlertConfig[];

  // Conexión frontend↔backend
  wsStatus: WSStatus;
  // Conexión backend↔BYMA (confirmada por "status:online")
  bymaConnected: boolean;

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

  setSummaries: (summaries: PairSummary[]) => void;

  addAlert: (alert: AlertEvent) => void;
  removeAlert: (alertId: string, timestamp: Date | string) => void;
  clearAlerts: () => void;

  setAlertConfigs: (configs: AlertConfig[]) => void;
  upsertAlertConfig: (config: AlertConfig) => void;
  removeAlertConfig: (id: string) => void;

  setWsStatus: (status: WSStatus) => void;
  setBymaConnected: (connected: boolean) => void;

  setSelectedPairId: (pairId: string | null) => void;

  setOpenExercisePairIds: (pairIds: string[]) => void;
  setPairExerciseOpen: (pairId: string, isOpen: boolean) => void;
}

const MAX_ALERTS = 20;

export const useMarketStore = create<MarketState>()(
  immer((set) => ({
    bonds: [],
    pairs: [],
    liveData: {},
    stats: {},
    summary: {},
    selectedWindow: "1m",
    selectedPairId: null,
    openExercisePairIds: [],
    recentAlerts: [],
    alertConfigs: [],
    wsStatus: "idle",
    bymaConnected: false,
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

    setSummaries: (summaries) =>
      set((state) => {
        state.summary = {};
        for (const s of summaries) state.summary[s.pairId] = s;
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

    setBymaConnected: (connected) =>
      set((state) => {
        state.bymaConnected = connected;
      }),

    setSelectedPairId: (pairId) =>
      set((state) => {
        state.selectedPairId = pairId;
      }),

    setOpenExercisePairIds: (pairIds) =>
      set((state) => {
        state.openExercisePairIds = pairIds;
      }),

    setPairExerciseOpen: (pairId, isOpen) =>
      set((state) => {
        const has = state.openExercisePairIds.includes(pairId);
        if (isOpen && !has) {
          state.openExercisePairIds.push(pairId);
        } else if (!isOpen && has) {
          state.openExercisePairIds = state.openExercisePairIds.filter(
            (id) => id !== pairId,
          );
        }
      }),
  })),
);

// ---- Selectores útiles ----

export const selectLiveByPair = (pairId: string) => (state: MarketState) =>
  state.liveData[pairId];

export const selectStatsByPair = (pairId: string) => (state: MarketState) =>
  state.stats[pairId];

export const selectSummaryByPair = (pairId: string) => (state: MarketState) =>
  state.summary[pairId];

export const selectIsConnected = (state: MarketState) => state.bymaConnected;

export const selectHasOpenExercise =
  (pairId: string) => (state: MarketState) =>
    state.openExercisePairIds.includes(pairId);
