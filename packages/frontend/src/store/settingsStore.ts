import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type RatioChartSettings,
} from "@arbitraje/shared";
import { fetchAppSettings, updateAppSettings } from "../services/api";

const SETTINGS_VERSION = 1;
const SYNC_DEBOUNCE_MS = 600;

type Status = "idle" | "loading" | "ready" | "error";

interface SettingsState {
  settings: AppSettings;
  status: Status;
  error: string | null;

  loadFromBackend: () => Promise<void>;
  updateRatioChart: (patch: Partial<RatioChartSettings>) => void;
  resetToDefaults: () => Promise<void>;
}

// Timer del debounce del sync — vive a nivel módulo (no en el state) para que
// el persist no lo serialice.
let syncTimer: ReturnType<typeof setTimeout> | null = null;

const scheduleSync = (ratioChart: RatioChartSettings) => {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    updateAppSettings({ ratioChart }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      useSettingsStore.setState({ error: msg });
      console.error("[settings] sync failed:", err);
    });
  }, SYNC_DEBOUNCE_MS);
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    immer((set, get) => ({
      settings: DEFAULT_APP_SETTINGS,
      status: "idle",
      error: null,

      loadFromBackend: async () => {
        set((s) => {
          s.status = "loading";
          s.error = null;
        });
        try {
          const remote = await fetchAppSettings();
          set((s) => {
            s.settings = remote;
            s.status = "ready";
          });
        } catch (err) {
          set((s) => {
            s.status = "error";
            s.error = err instanceof Error ? err.message : "Error desconocido";
          });
        }
      },

      updateRatioChart: (patch) => {
        set((s) => {
          s.settings.ratioChart = { ...s.settings.ratioChart, ...patch };
        });
        scheduleSync(get().settings.ratioChart);
      },

      resetToDefaults: async () => {
        set((s) => {
          s.settings = DEFAULT_APP_SETTINGS;
        });
        scheduleSync(DEFAULT_APP_SETTINGS.ratioChart);
      },
    })),
    {
      name: "arbbonos-settings",
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings }),
      migrate: (persistedState, version) => {
        if (version < SETTINGS_VERSION) {
          return {
            settings: DEFAULT_APP_SETTINGS,
          } as Partial<SettingsState>;
        }
        return persistedState as Partial<SettingsState>;
      },
    },
  ),
);
