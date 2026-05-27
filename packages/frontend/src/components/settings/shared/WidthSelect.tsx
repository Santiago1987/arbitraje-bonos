import clsx from "clsx";

interface WidthSelectProps {
  value: number;
  onChange: (width: number) => void;
  color?: string;
  label?: string;
  min?: number;
  max?: number;
}

export function WidthSelect({
  value,
  onChange,
  color = "#94a3b8",
  label,
  min = 1,
  max = 6,
}: WidthSelectProps) {
  const widths = Array.from({ length: max - min + 1 }, (_, i) => i + min);
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-xs text-muted uppercase tracking-wide">
          {label}
        </span>
      )}
      <div className="flex gap-1.5">
        {widths.map((w) => {
          const isActive = w === value;
          return (
            <button
              key={w}
              type="button"
              onClick={() => onChange(w)}
              className={clsx(
                "flex flex-col items-center justify-center gap-1 px-2.5 py-2 rounded border transition-colors w-12",
                isActive
                  ? "border-accent-cyan bg-accent-cyan/10"
                  : "border-surface-3/40 bg-surface-2 hover:bg-surface-3",
              )}
            >
              <div
                className="w-7 rounded-full"
                style={{ height: `${w}px`, backgroundColor: color }}
              />
              <span className="text-[10px] text-muted">{w}px</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
