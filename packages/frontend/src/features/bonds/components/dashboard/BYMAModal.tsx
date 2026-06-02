import { useState } from "react";
import { X } from "lucide-react";
import { connectByma } from "../../services/api";

interface Props {
  handleOnClickBymaModal: (show: boolean) => void;
}

const BYMAModal = ({ handleOnClickBymaModal }: Props) => {
  const [bymaSessionId, setBymaSessionId] = useState("");
  const [bymaConnId, setBymaConnId] = useState("");
  const [bymaWsKey, setBymaWsKey] = useState("");
  const [bymaConnecting, setBymaConnecting] = useState(false);
  const [bymaError, setBymaError] = useState<string | null>(null);

  const handleBymaConnect = async () => {
    setBymaError(null);
    setBymaConnecting(true);
    try {
      await connectByma({
        sessionId: bymaSessionId,
        connId: bymaConnId,
        wsSecKey: bymaWsKey,
      });
      handleOnClickBymaModal(false);
    } catch (err) {
      setBymaError(err instanceof Error ? err.message : "Error al conectar");
    } finally {
      setBymaConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-1 rounded-xl border border-surface-3 shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Conectar a BYMA</h2>
          <button
            onClick={() => handleOnClickBymaModal(false)}
            className="p-1 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">Session ID</label>
            <input
              type="text"
              value={bymaSessionId}
              onChange={(e) => setBymaSessionId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              Connection ID
            </label>
            <input
              type="text"
              value={bymaConnId}
              onChange={(e) => setBymaConnId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
            />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">
              WebSocket Key
            </label>
            <input
              type="text"
              value={bymaWsKey}
              onChange={(e) => setBymaWsKey(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-surface-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-blue"
            />
          </div>

          {bymaError && (
            <div className="text-sm text-accent-red bg-accent-red/10 border border-accent-red/20 rounded-lg px-3 py-2">
              {bymaError}
            </div>
          )}

          <button
            onClick={handleBymaConnect}
            disabled={
              bymaConnecting || !bymaSessionId || !bymaConnId || !bymaWsKey
            }
            className="w-full py-2.5 rounded-lg bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {bymaConnecting ? "Conectando..." : "Iniciar conexión"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BYMAModal;
