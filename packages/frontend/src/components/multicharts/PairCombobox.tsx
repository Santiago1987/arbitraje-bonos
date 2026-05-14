import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { useMarketStore } from "../../store/marketStore";

interface Props {
  value: string | null;
  onChange: (pairId: string | null) => void;
  placeholder?: string;
}

export const PairCombobox = ({ value, onChange, placeholder }: Props) => {
  const pairs = useMarketStore((s) => s.pairs);
  const selected = useMemo(
    () => pairs.find((p) => p.id === value) ?? null,
    [pairs, value],
  );

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return pairs;
    return pairs.filter((p) => p.name.toLowerCase().includes(needle));
  }, [pairs, query]);

  const handleSelect = (pairId: string) => {
    onChange(pairId);
    setQuery("");
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setQuery("");
  };

  const inputValue = open ? query : selected ? selected.name : query;

  return (
    <div className="relative">
      <div
        ref={wrapperRef}
        className={`relative w-full ${selected ? "hidden" : ""}`}
      >
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onFocus={() => {
              setOpen(true);
              if (selected) setQuery("");
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            placeholder={placeholder ?? "Seleccioná un par…"}
            className="w-full px-2.5 py-1.5 pr-7 rounded-md bg-surface-2 border border-surface-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-blue"
          />
        </div>

        {open && (
          <div className="absolute z-20 mt-1 left-0 right-0 max-h-72 overflow-y-auto bg-surface-1 border border-surface-3 rounded-lg shadow-xl">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted">
                Sin coincidencias
              </div>
            ) : (
              <ul>
                {filtered.map((p) => {
                  const isSelected = selected?.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(p.id)}
                        className={clsx(
                          "w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between gap-3",
                          isSelected
                            ? "bg-accent-blue/15 text-white"
                            : "hover:bg-surface-2 text-white",
                        )}
                      >
                        <div className="font-mono font-medium truncate">
                          {p.name}
                        </div>
                        <div className="text-xs text-muted whitespace-nowrap">
                          {p.type}
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
      {selected && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 top-1 z-10 -translate-y-1/2 p-0.5 border border-surface-20/30 border-white text-white bg-surface-20/30
          rounded hover:bg-surface-3 hover:text-white transition-colors"
          aria-label="Limpiar selección"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default PairCombobox;
