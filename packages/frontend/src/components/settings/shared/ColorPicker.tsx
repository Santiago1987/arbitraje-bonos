import clsx from "clsx";
import { Check } from "lucide-react";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  suggestedColors?: string[];
  label?: string;
}

const DEFAULT_PALETTE = [
  "#f97316",
  "#02CF28",
  "#F20202",
  "#FF0000",
  "#3b82f6",
  "#06b6d4",
  "#A855F7",
  "#eab308",
];

// <input type="color"> requiere "#rrggbb". Si el color viene en otro formato
// (ej. "rgba(...)") devolvemos "#000000" para que el picker no se rompa.
const toHex = (color: string): string => {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return (
      "#" +
      color
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  return "#000000";
};

export function ColorPicker({
  value,
  onChange,
  suggestedColors = DEFAULT_PALETTE,
  label,
}: ColorPickerProps) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-xs text-muted uppercase tracking-wide">
          {label}
        </span>
      )}
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded border border-surface-3/40 bg-surface-2 cursor-pointer p-0"
        />
        <div className="flex flex-wrap gap-1.5">
          {suggestedColors.map((c) => {
            const isActive = c.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                title={c}
                className={clsx(
                  "w-6 h-6 rounded border transition-all flex items-center justify-center",
                  isActive
                    ? "border-white scale-110"
                    : "border-surface-3/40 hover:scale-105",
                )}
                style={{ backgroundColor: c }}
              >
                {isActive && <Check size={12} className="text-white drop-shadow" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
