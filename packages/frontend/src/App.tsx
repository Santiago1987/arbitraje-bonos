import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./components/dashboard/Dashboard";
import ChartsView from "./components/charts/ChartsView";
import MultiChartsView from "./components/multicharts/MultiChartsView";
import SettingsPage from "./components/settings/SettingsPage";
import type { PairLiveData } from "@arbitraje/shared";
import { useMarketStore } from "./store/marketStore";
import { useSettingsStore } from "./store/settingsStore";
import { fetchBonds, fetchPairs } from "./services/api";
import { initWS, closeWS, subscribeToPairs } from "./services/wsClient";

type LiveMap = Record<string, PairLiveData>;

function useBootstrap() {
  // 1) Cargar pares + live data inicial (desde memoria del backend)
  useEffect(() => {
    const store = useMarketStore.getState();
    let cancelled = false;

    (async () => {
      store.setPairsLoading(true);
      store.setPairsError(null);
      try {
        const [pairs, bonds] = await Promise.all([fetchPairs(), fetchBonds()]);
        if (cancelled) return;

        store.setBonds(bonds);

        const live: LiveMap = {};
        for (const p of pairs) {
          if (p.live) live[p.id] = p.live;
        }

        store.setPairs(
          pairs.map(({ live: _live, ...rest }) => rest),
          live,
        );

        subscribeToPairs(pairs.map((p) => p.id));
      } catch (err) {
        if (cancelled) return;
        console.error("Error cargando datos iniciales:", err);
        store.setPairsError(
          err instanceof Error ? err.message : "Error desconocido",
        );
      } finally {
        if (!cancelled) store.setPairsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 2) Abrir WS una sola vez
  useEffect(() => {
    initWS();
    return () => {
      closeWS();
    };
  }, []);

  // 3) Hidratar settings desde backend (localStorage ya hidrató sync via persist)
  useEffect(() => {
    void useSettingsStore.getState().loadFromBackend();
  }, []);
}

export default function App() {
  useBootstrap();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="charts" element={<ChartsView />} />
          <Route path="multicharts" element={<MultiChartsView />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
