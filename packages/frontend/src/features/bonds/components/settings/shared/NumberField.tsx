interface NumberFieldProps {
  value: number;
  onChange: (n: number) => void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export function NumberField({
  value,
  onChange,
  label,
  min,
  max,
  step = 1,
  hint,
}: NumberFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-xs text-muted uppercase tracking-wide">
          {label}
        </span>
      )}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          if (min !== undefined && n < min) return;
          if (max !== undefined && n > max) return;
          onChange(n);
        }}
        className="bg-surface-2 border border-surface-3/40 rounded px-3 py-1.5 font-mono text-sm text-gray-100 w-28 focus:outline-none focus:border-accent-cyan"
      />
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </div>
  );
}
