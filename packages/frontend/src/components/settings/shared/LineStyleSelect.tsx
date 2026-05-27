import clsx from "clsx";
import type { LineStyleType } from "@arbitraje/shared";

interface LineStyleSelectProps {
  value: LineStyleType;
  onChange: (style: LineStyleType) => void;
  color?: string;
  label?: string;
}

const OPTIONS: { value: LineStyleType; label: string; dasharray: string }[] = [
  { value: "solid", label: "Sólida", dasharray: "" },
  { value: "dashed", label: "Dasheada", dasharray: "6 4" },
  { value: "dotted", label: "Punteada", dasharray: "2 3" },
];

export function LineStyleSelect({
  value,
  onChange,
  color = "#94a3b8",
  label,
}: LineStyleSelectProps) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-xs text-muted uppercase tracking-wide">
          {label}
        </span>
      )}
      <div className="flex gap-1.5">
        {OPTIONS.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={clsx(
                "flex flex-col items-center gap-1 px-3 py-2 rounded border transition-colors",
                isActive
                  ? "border-accent-cyan bg-accent-cyan/10"
                  : "border-surface-3/40 bg-surface-2 hover:bg-surface-3",
              )}
            >
              <svg width="40" height="6" viewBox="0 0 40 6">
                <line
                  x1="2"
                  y1="3"
                  x2="38"
                  y2="3"
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray={opt.dasharray}
                />
              </svg>
              <span className="text-[10px] text-muted">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
