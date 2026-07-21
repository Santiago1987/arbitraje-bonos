import type {
  WSMessage,
  PairLiveData,
  AlertEvent,
  StockArbUpdate,
} from "@arbitraje/shared";
import { useMarketStore } from "../store/marketStore";
import { useStockArbStore } from "../../stocks/store/stockArbStore";
import { playAlertSound } from "./sound";

/**
 * Cliente WebSocket singleton.
 *
 * Escribe directo al store (sin callbacks de React), para evitar
 * overhead de re-renders en el procesamiento de cada mensaje.
 * Los componentes se suscriben al store con selectores granulares.
 */

let ws: WebSocket | null = null;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let subscribedPairIds = new Set<string>();
let subscribedStocks = false;
let manuallyClosed = false;

function send(msg: WSMessage) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function buildUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function handleMessage(event: MessageEvent) {
  let msg: WSMessage;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }

  const store = useMarketStore.getState();

  switch (msg.type) {
    case "pair_update":
      store.updateLive(msg.payload as PairLiveData);
      break;
    case "stock_arb_update":
      useStockArbStore.getState().updateRow(msg.payload as StockArbUpdate);
      break;
    case "alert_triggered":
      store.addAlert(msg.payload as AlertEvent);
      playAlertSound();
      break;
    case "byma_status":
      store.setBymaConnected((msg.payload as { connected: boolean }).connected);
      break;
    case "heartbeat":
      send({ type: "heartbeat", payload: {}, timestamp: new Date() });
      break;
  }
}

function connect() {
  manuallyClosed = false;
  const store = useMarketStore.getState();
  store.setWsStatus("connecting");

  ws = new WebSocket(buildUrl());

  ws.onopen = () => {
    retryCount = 0;
    useMarketStore.getState().setWsStatus("connected");

    send({
      type: "subscribe",
      payload: { channel: "alerts" },
      timestamp: new Date(),
    });

    if (subscribedPairIds.size > 0) {
      send({
        type: "subscribe",
        payload: { channel: "pairs", pairIds: [...subscribedPairIds] },
        timestamp: new Date(),
      });
    }

    if (subscribedStocks) {
      send({
        type: "subscribe",
        payload: { channel: "stocks" },
        timestamp: new Date(),
      });
    }
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    ws = null;
    const s = useMarketStore.getState();
    s.setWsStatus("disconnected");
    s.setBymaConnected(false);
    if (manuallyClosed) return;

    const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
    retryCount++;
    retryTimer = setTimeout(connect, delay);
  };

  ws.onerror = () => {
    // close se dispara después
  };
}

export function initWS() {
  if (ws) return;
  connect();
}

export function closeWS() {
  manuallyClosed = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  subscribedPairIds.clear();
  subscribedStocks = false;
}

/** Suscripción al arbitraje de acciones CI/24hs. La llama la vista al montar. */
export function subscribeToStocks() {
  if (subscribedStocks) return;
  subscribedStocks = true;
  send({
    type: "subscribe",
    payload: { channel: "stocks" },
    timestamp: new Date(),
  });
}

export function unsubscribeFromStocks() {
  if (!subscribedStocks) return;
  subscribedStocks = false;
  send({
    type: "unsubscribe",
    payload: { channel: "stocks" },
    timestamp: new Date(),
  });
}

export function subscribeToPairs(pairIds: string[]) {
  const next = pairIds.filter((id) => !subscribedPairIds.has(id));
  for (const id of pairIds) subscribedPairIds.add(id);
  if (next.length > 0) {
    send({
      type: "subscribe",
      payload: { channel: "pairs", pairIds: next },
      timestamp: new Date(),
    });
  }
}

export function unsubscribeFromPairs(pairIds: string[]) {
  for (const id of pairIds) subscribedPairIds.delete(id);
  send({
    type: "unsubscribe",
    payload: { channel: "pairs", pairIds },
    timestamp: new Date(),
  });
}
