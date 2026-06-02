import clsx from "clsx";
import type { ReactNode } from "react";
import type { IndicatorLineConfig, LineStyleType } from "@arbitraje/shared";
import { ColorPicker } from "./ColorPicker";
import { WidthSelect } from "./WidthSelect";
import { LineStyleSelect } from "./LineStyleSelect";

interface IndicatorBlockProps {
  title: string;
  description?: string;
  config: IndicatorLineConfig;
  onChange: (patch: Partial<IndicatorLineConfig>) => void;
  suggestedColors?: string[];
  extras?: ReactNode;
}

export function IndicatorBlock({
  title,
  description,
  config,
  onChange,
  suggestedColors,
  extras,
}: IndicatorBlockProps) {
  return (
    <div className="card rounded-lg p-4 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
          {description && (
            <p className="text-xs text-muted mt-0.5">{description}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange({ enabled: !config.enabled })}
          className={clsx(
            "relative w-11 h-6 rounded-full transition-colors",
            config.enabled ? "bg-accent-cyan" : "bg-surface-3",
          )}
        >
          <span
            className={clsx(
              "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform",
              config.enabled ? "translate-x-5" : "translate-x-0.5",
            )}
          />
        </button>
      </header>

      <div
        className={clsx(
          "grid gap-4 transition-opacity",
          !config.enabled && "opacity-40 pointer-events-none",
        )}
      >
        <div className="flex flex-wrap gap-6">
          <ColorPicker
            label="Color"
            value={config.color}
            onChange={(color) => onChange({ color })}
            suggestedColors={suggestedColors}
          />
          <WidthSelect
            label="Grosor"
            value={config.width}
            onChange={(width) => onChange({ width })}
            color={config.color}
          />
          <LineStyleSelect
            label="Estilo"
            value={config.style}
            onChange={(style: LineStyleType) => onChange({ style })}
            color={config.color}
          />
        </div>
        {extras && <div className="flex flex-wrap gap-4">{extras}</div>}
      </div>
    </div>
  );
}
