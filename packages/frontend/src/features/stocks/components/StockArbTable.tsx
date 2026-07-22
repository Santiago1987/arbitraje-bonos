import clsx from "clsx";
import type { StockArbUpdate } from "@arbitraje/shared";

interface Props {
  rows: StockArbUpdate[];
}

const numberFmt = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : numberFmt.format(n);

const StockArbTable = ({ rows }: Props) => {
  return (
    <div className="overflow-hidden rounded-lg">
      <div className="grid grid-cols-6 gap-px bg-surface-3/20 text-xs uppercase tracking-wider text-muted font-medium">
        <div className="card px-2 py-2">Ticker</div>
        <div
          className="card px-2 py-2 text-right"
          title="Precio ask usado en el cálculo (compra CI)"
        >
          CI
        </div>
        <div
          className="card px-2 py-2 text-right"
          title="Precio bid usado en el cálculo (venta 24hs)"
        >
          24hs
        </div>
        <div className="card px-2 py-2 text-right">Diferencia</div>
        <div className="card px-2 py-2 text-right">Valor pase</div>
        <div className="card px-2 py-2 text-right">Ganancia</div>
      </div>

      {rows.length === 0 ? (
        <div className="card py-8 text-center text-muted text-sm">
          Sin datos todavía
        </div>
      ) : (
        rows.map((r) => (
          <div
            key={r.ticker}
            className="grid grid-cols-6 gap-px bg-surface-3/10 text-sm font-mono border-b border-surface-3/10"
          >
            <div className="card px-2 py-2 font-semibold text-white truncate">
              {r.ticker}
            </div>
            <div
              className="card px-2 py-2 text-right"
              title={r.ci ? `bid ${fmt(r.ci)} / ask ${fmt(r.ci)}` : undefined}
            >
              {r.ci ? fmt(r.ci) : "—"}
            </div>
            <div
              className="card px-2 py-2 text-right"
              title={
                r.h24 ? `bid ${fmt(r.h24)} / ask ${fmt(r.h24)}` : undefined
              }
            >
              {r.h24 ? fmt(r.h24) : "—"}
            </div>
            <div className="card px-2 py-2 text-right">{fmt(r.diferencia)}</div>
            <div className="card px-2 py-2 text-right">{fmt(r.valorPase)}</div>
            <div
              className={clsx(
                "card px-2 py-2 text-right font-semibold",
                r.ganancia != null &&
                  (r.ganancia >= 0 ? "text-accent-green" : "text-accent-red"),
              )}
            >
              {fmt(r.ganancia)}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default StockArbTable;
