'use client';

// The sales chart of the ported diagram, drawn from core's series (GET /vendors/dashboard/metrics): the line is the
// revenue in FCFA, the bars the number of paid orders. Same viewBox and layers as the diagram; the labels are HTML,
// so they keep their size when the SVG stretches.

import { fmtDay, fmtInt, fmtMonth, fmtShort } from './format';
import type { DashboardMetrics } from './types';

const W = 640;
const H = 170;
const TOP = 12;
const BOTTOM = 160;

/** A round top for the axis: 1, 2 or 5 times a power of ten, at or above the highest value. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** A smooth path through the points (Catmull-Rom as cubic Béziers), clamped to the plot. */
function smooth(points: [number, number][]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0] as [number, number];
    return `M${x - 4} ${y} L${x + 4} ${y}`;
  }
  let d = `M${points[0]?.[0]} ${points[0]?.[1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i] as [number, number];
    const p2 = points[i + 1] as [number, number];
    const p3 = points[i + 2] ?? p2;
    const c1y = Math.min(BOTTOM, Math.max(TOP, p1[1] + (p2[1] - (p0?.[1] ?? p1[1])) / 6));
    const c2y = Math.min(BOTTOM, Math.max(TOP, p2[1] - (p3[1] - p1[1]) / 6));
    const c1x = p1[0] + (p2[0] - (p0?.[0] ?? p1[0])) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function SalesChart({ metrics }: { metrics: DashboardMetrics }) {
  const s = metrics.series;
  const maxRevenue = niceMax(Math.max(...s.map((p) => p.revenue_xof), 0));
  const maxOrders = Math.max(...s.map((p) => p.orders), 1);
  const empty = s.every((p) => p.revenue_xof === 0 && p.orders === 0);
  const step = s.length > 1 ? W / (s.length - 1) : 0;
  const x = (i: number) => (s.length > 1 ? i * step : W / 2);
  const y = (v: number) => BOTTOM - (v / maxRevenue) * (BOTTOM - TOP);
  const points = s.map((p, i) => [x(i), y(p.revenue_xof)] as [number, number]);
  const line = smooth(points);
  const area = points.length > 1 ? `${line} L${W} ${BOTTOM} L0 ${BOTTOM}Z` : '';
  const barW = Math.max(3, Math.min(14, (W / Math.max(s.length, 1)) * 0.35));
  const label = (date: string) => (metrics.period === 'year' ? fmtMonth(date) : fmtDay(date));
  // At most 7 date labels, spread evenly, the last one always shown.
  const every = Math.max(1, Math.ceil(s.length / 7));
  const ticks = s
    .map((p, i) => ({ i, date: p.date }))
    .filter(({ i }) => i % every === 0 || i === s.length - 1)
    .filter(({ i }, k, all) => k === all.length - 1 || s.length - 1 - i >= every / 2 || i === 0);

  if (empty) {
    return (
      <div className="chart-empty">
        Pas encore de vente payée sur cette période. Elles apparaîtront ici dès le premier paiement.
      </div>
    );
  }

  return (
    <div className="chart-box">
      <div className="chart-plot">
        {[1, 0.75, 0.5, 0.25].map((f) => (
          <span
            key={f}
            className="chart-y"
            style={{ top: `${((y(maxRevenue * f) / H) * 100).toFixed(2)}%` }}
          >
            {fmtShort(maxRevenue * f)}
          </span>
        ))}
        <svg
          className="chart"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Ventes payées par ${metrics.period === 'year' ? 'mois' : 'jour'} : ${s
            .map(
              (p) =>
                `${label(p.date)} ${fmtInt(p.revenue_xof)} FCFA, ${p.orders} commande${p.orders > 1 ? 's' : ''}`,
            )
            .join(' ; ')}`}
        >
          <defs>
            <linearGradient id="sales-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#8AAE4A" stopOpacity=".24" />
              <stop offset="1" stopColor="#8AAE4A" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[1, 0.75, 0.5, 0.25].map((f) => (
            <line
              key={f}
              className="gridline"
              x1="0"
              x2={W}
              y1={y(maxRevenue * f)}
              y2={y(maxRevenue * f)}
            />
          ))}
          <g>
            {s.map((p, i) => {
              const h = (p.orders / maxOrders) * (BOTTOM - TOP) * 0.45;
              return (
                <rect
                  key={p.date}
                  className="bars"
                  x={Math.min(W - barW, Math.max(0, x(i) - barW / 2))}
                  y={BOTTOM - h}
                  width={barW}
                  height={h}
                >
                  <title>{`${label(p.date)} : ${p.orders} commande${p.orders > 1 ? 's' : ''}, ${fmtInt(p.revenue_xof)} FCFA`}</title>
                </rect>
              );
            })}
          </g>
          {area && <path className="area" d={area} />}
          <path className="line" d={line} />
          <line className="baseline" x1="0" x2={W} y1={BOTTOM} y2={BOTTOM} />
        </svg>
      </div>
      <div className="chart-ticks" aria-hidden="true">
        {ticks.map(({ i, date }) => (
          <span key={date} style={{ left: `${((x(i) / W) * 100).toFixed(2)}%` }}>
            {label(date)}
          </span>
        ))}
      </div>
    </div>
  );
}
