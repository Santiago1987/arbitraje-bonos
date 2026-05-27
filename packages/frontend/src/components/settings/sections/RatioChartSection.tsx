import clsx from "clsx";
import { RotateCcw } from "lucide-react";
import type { TimeframeKey } from "@arbitraje/shared";
import { useSettingsStore } from "../../../store/settingsStore";
import { IndicatorBlock } from "../shared/IndicatorBlock";
import { ColorPicker } from "../shared/ColorPicker";
import { WidthSelect } from "../shared/WidthSelect";
import { LineStyleSelect } from "../shared/LineStyleSelect";
import { NumberField } from "../shared/NumberField";

const ALLOWED_TIMEFRAMES: TimeframeKey[] = ["5m", "15m", "1h"];

export function RatioChartSection() {
  const rc = useSettingsStore((s) => s.settings.ratioChart);
  const update = useSettingsStore((s) => s.updateRatioChart);
  const reset = useSettingsStore((s) => s.resetToDefaults);
  const status = useSettingsStore((s) => s.status);

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Gráfico de Ratio</h2>
          <p className="text-sm text-muted mt-1">
            Configurá el timeframe e indicadores del componente RatioChart.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reset()}
          className="flex items-center gap-2 px-3 py-1.5 rounded border border-surface-3/40 bg-surface-2 hover:bg-surface-3 text-sm text-muted hover:text-gray-100 transition-colors"
        >
          <RotateCcw size={14} />
          Restaurar defaults
        </button>
      </header>

      {/* Timeframe */}
      <div className="card rounded-lg p-4 flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-100">Timeframe</h3>
          <p className="text-xs text-muted mt-0.5">
            Duración del bucket de cada vela.
          </p>
        </div>
        <div className="flex gap-2">
          {ALLOWED_TIMEFRAMES.map((tf) => {
            const isActive = tf === rc.timeframe;
            return (
              <button
                key={tf}
                type="button"
                onClick={() => update({ timeframe: tf })}
                className={clsx(
                  "px-4 py-2 rounded border font-mono text-sm transition-colors",
                  isActive
                    ? "border-accent-cyan bg-accent-cyan/10 text-accent-cyan"
                    : "border-surface-3/40 bg-surface-2 hover:bg-surface-3 text-muted",
                )}
              >
                {tf}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted">
          4h y 1d quedan fuera porque rompen la lógica de "sesiones lógicas" del
          chart (menos de 2 buckets por rueda).
        </p>
      </div>

      {/* SMA */}
      <IndicatorBlock
        title="SMA"
        description="Media móvil simple sobre los cierres de velas regulares."
        config={rc.sma}
        onChange={(patch) => update({ sma: { ...rc.sma, ...patch } })}
        extras={
          <NumberField
            label="Período"
            value={rc.sma.period}
            min={2}
            max={1000}
            onChange={(period) => update({ sma: { ...rc.sma, period } })}
          />
        }
      />

      {/* Promant */}
      <IndicatorBlock
        title="Promedio rueda anterior"
        description="Línea horizontal con el promedio de cierre de la rueda anterior."
        config={rc.promant}
        onChange={(patch) =>
          update({ promant: { ...rc.promant, ...patch } })
        }
      />

      {/* Prommonth */}
      <IndicatorBlock
        title="Promedio 21 ruedas"
        description="Línea horizontal con el promedio de cierre de las últimas 21 ruedas."
        config={rc.prommonth}
        onChange={(patch) =>
          update({ prommonth: { ...rc.prommonth, ...patch } })
        }
      />

      {/* Bollinger Bands */}
      <IndicatorBlock
        title="Bollinger Bands"
        description="Bandas calculadas como SMA ± stdDev × σ sobre velas regulares."
        config={rc.bollinger}
        onChange={(patch) =>
          update({ bollinger: { ...rc.bollinger, ...patch } })
        }
        extras={
          <>
            <NumberField
              label="Período"
              value={rc.bollinger.period}
              min={2}
              max={1000}
              onChange={(period) =>
                update({ bollinger: { ...rc.bollinger, period } })
              }
            />
            <NumberField
              label="Desvío (σ)"
              value={rc.bollinger.stdDev}
              min={0.5}
              max={5}
              step={0.1}
              onChange={(stdDev) =>
                update({ bollinger: { ...rc.bollinger, stdDev } })
              }
            />
          </>
        }
      />

      {/* Daily bands */}
      <div className="card rounded-lg p-4 flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">
              Bandas diarias
            </h3>
            <p className="text-xs text-muted mt-0.5">
              Proyección de excursión esperada sobre el avgClose del día anterior.
              Fórmula custom del backend.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              update({
                dailyBands: {
                  ...rc.dailyBands,
                  enabled: !rc.dailyBands.enabled,
                },
              })
            }
            className={clsx(
              "relative w-11 h-6 rounded-full transition-colors",
              rc.dailyBands.enabled ? "bg-accent-cyan" : "bg-surface-3",
            )}
          >
            <span
              className={clsx(
                "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
                rc.dailyBands.enabled ? "translate-x-5" : "translate-x-0.5",
              )}
            />
          </button>
        </header>

        <div
          className={clsx(
            "flex flex-wrap gap-6 transition-opacity",
            !rc.dailyBands.enabled && "opacity-40 pointer-events-none",
          )}
        >
          <ColorPicker
            label="Color upperband"
            value={rc.dailyBands.upperColor}
            onChange={(upperColor) =>
              update({ dailyBands: { ...rc.dailyBands, upperColor } })
            }
          />
          <ColorPicker
            label="Color lowerband"
            value={rc.dailyBands.lowerColor}
            onChange={(lowerColor) =>
              update({ dailyBands: { ...rc.dailyBands, lowerColor } })
            }
          />
          <WidthSelect
            label="Grosor"
            value={rc.dailyBands.width}
            onChange={(width) =>
              update({ dailyBands: { ...rc.dailyBands, width } })
            }
            color={rc.dailyBands.upperColor}
          />
          <LineStyleSelect
            label="Estilo"
            value={rc.dailyBands.style}
            onChange={(style) =>
              update({ dailyBands: { ...rc.dailyBands, style } })
            }
            color={rc.dailyBands.upperColor}
          />
        </div>
      </div>

      {status === "error" && (
        <div className="text-xs text-accent-red border border-accent-red/30 bg-accent-red/10 rounded p-2">
          Error al sincronizar con el backend. Los cambios se guardan localmente.
        </div>
      )}
    </div>
  );
}
