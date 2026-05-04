import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import type { Bond } from "@arbitraje/shared";
import { useMarketStore } from "../../store/marketStore";

interface Props {
  label: string;
  value: Bond | null;
  onChange: (bond: Bond | null) => void;
  excludeFullTicker?: string; // p.ej. para que A no muestre el bono ya elegido en B
  placeholder?: string;
}

const matches = (bond: Bond, q: string): boolean => {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    bond.fullTicker.toLowerCase().includes(needle) ||
    bond.ticker.toLowerCase().includes(needle) ||
    bond.name.toLowerCase().includes(needle)
  );
};

export const BondAutocomplete = ({
  label,
  value,
  onChange,
  excludeFullTicker,
  placeholder,
}: Props) => {
  const bonds = useMarketStore((s) => s.bonds);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Cerrar el dropdown al click fuera
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    return bonds
      .filter((b) => b.fullTicker !== excludeFullTicker)
      .filter((b) => matches(b, query))
      .slice(0, 50);
  }, [bonds, query, excludeFullTicker]);

  const handleSelect = (bond: Bond) => {
    onChange(bond);
    setQuery("");
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setQuery("");
  };

  // Lo que se muestra dentro del input depende de si hay selección y si está abierto.
  const inputValue = open ? query : value ? value.fullTicker : query;

  return (
    <div ref={wrapperRef} className="relative flex-1 min-w-0">
      <label className="block text-xs uppercase tracking-wider text-muted mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onFocus={() => {
            setOpen(true);
            // Al abrir con un valor seleccionado, vaciamos el query para que
            // el usuario vea todas las opciones (filtrado parte de cero).
            if (value) setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder ?? "Buscar bono…"}
          className="w-full px-3 py-2 pr-8 rounded-lg bg-surface-2 border border-surface-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-blue"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-surface-3 text-muted hover:text-white transition-colors"
            aria-label="Limpiar selección"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1 left-0 right-0 max-h-72 overflow-y-auto bg-surface-1 border border-surface-3 rounded-lg shadow-xl">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted">Sin coincidencias</div>
          ) : (
            <ul>
              {filtered.map((b) => {
                const selected = value?.fullTicker === b.fullTicker;
                return (
                  <li key={b.fullTicker}>
                    <button
                      type="button"
                      onClick={() => handleSelect(b)}
                      className={clsx(
                        "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-3",
                        selected
                          ? "bg-accent-blue/15 text-white"
                          : "hover:bg-surface-2 text-white",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-medium truncate">
                          {b.fullTicker}
                        </div>
                        <div className="text-xs text-muted truncate">
                          {b.name}
                        </div>
                      </div>
                      <div className="text-xs text-muted whitespace-nowrap">
                        {b.currency} · {b.law} · {b.settlement}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default BondAutocomplete;
