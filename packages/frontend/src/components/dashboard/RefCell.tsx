import clsx from "clsx";

interface RefCellProps {
  value: number | null | undefined;
  current: number | undefined;
}

const DIFF_CAP_PCT = 2;

const getDiffColor = (diff: number | null): string | undefined => {
  if (diff === null || diff === 0) return undefined;
  const intensity = Math.min(Math.abs(diff) / DIFF_CAP_PCT, 1);
  const hue = diff < 0 ? 142 : 0;
  const saturation = 20 + intensity * 70;
  const lightness = 60 - intensity * 5;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

const RefCell = ({ value, current }: RefCellProps) => {
  const hasValue = typeof value === "number" && Number.isFinite(value);
  const diff =
    hasValue && typeof current === "number" && value !== 0
      ? ((current - value) / value) * 100
      : null;

  const color = getDiffColor(diff);

  return (
    <div className="card p-2 grid grid-cols-2 items-center border-b border-surface-3/20 bg-surface-1/40">
      <div className="text-right pr-2 font-mono text-white text-base">
        {hasValue ? value.toFixed(5) : "—"}
      </div>
      <div
        className={clsx(
          "text-right font-mono text-base",
          diff === null && "text-muted",
        )}
        style={color ? { color } : undefined}
      >
        {diff === null ? "—" : `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`}
      </div>
    </div>
  );
};

export default RefCell;
