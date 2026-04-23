import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { Dashboard } from "./components/dashboard/Dashboard";
import type { PairLiveData } from "@arbitraje/shared";
import { useMarketStore } from "./store/marketStore";
import { fetchPairs } from "./services/api";
import { initWS, closeWS, subscribeToPairs } from "./services/wsClient";

type LiveMap = Record<string, PairLiveData>;

// Placeholders para las vistas que vas a ir construyendo
function ChartsPage() {
  return (
    <div className="text-muted text-center py-20">
      <p className="text-lg">Gráficos - Próximamente</p>
      <p className="text-sm mt-2">
        Acá vas a ver los charts interactivos de cada par
      </p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="text-muted text-center py-20">
      <p className="text-lg">Configuración - Próximamente</p>
      <p className="text-sm mt-2">ABM de pares y parámetros del sistema</p>
    </div>
  );
}

function useBootstrap() {
  // 1) Cargar pares + live data inicial (desde memoria del backend)
  useEffect(() => {
    const store = useMarketStore.getState();
    let cancelled = false;

    (async () => {
      store.setPairsLoading(true);
      store.setPairsError(null);
      try {
        const pairs = await fetchPairs();
        if (cancelled) return;

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
}

export default function App() {
  useBootstrap();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="charts" element={<ChartsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
