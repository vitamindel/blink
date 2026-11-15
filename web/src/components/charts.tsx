"use client";
import { useMemo, useState } from "react";
import type { LcPoint } from "@/lib/types";

/** Light curve as small multiples: one panel per detector, one neutral colour, shared time axis.
 *  (Six colour-coded series would not stay distinguishable in a scatter; facets do.) */
export function LightCurveMultiples({ points, height = 54 }: { points: LcPoint[]; height?: number }) {
  const [hover, setHover] = useState<LcPoint | null>(null);
  const dets = [1, 2, 3, 4, 5, 6].filter((d) => points.some((p) => p.detector === d));
  const years = points.map((p) => p.year);
  const x0 = Math.min(...years) - 0.03;
  const x1 = Math.max(...years) + 0.03;
  const W = 248;
  const padL = 34;
  const sx = (y: number) => padL + ((y - x0) / Math.max(x1 - x0, 1e-3)) * (W - padL - 6);
  if (!points.length) return <div className="text-[12px] text-fg-faint">No photometry.</div>;
  const ticks = Array.from(new Set(points.map((p) => Math.round(p.year * 2) / 2))).sort();

  return (
    <div className="relative">
      {dets.map((d) => {
        const ps = points.filter((p) => p.detector === d);
        const lo = Math.min(...ps.map((p) => p.flux_ujy - p.eflux_ujy));
        const hi = Math.max(...ps.map((p) => p.flux_ujy + p.eflux_ujy));
        const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
        const y0 = lo - pad;
        const y1 = hi + pad;
        const sy = (v: number) => 4 + (1 - (v - y0) / (y1 - y0)) * (height - 8);
        const wl = ps.find((p) => p.wave_min_um)?.wave_min_um;
        const amp = ps.length > 1 ? Math.max(...ps.map((p) => p.flux_ujy)) / Math.max(Math.min(...ps.map((p) => p.flux_ujy)), 1e-9) : null;
        return (
          <div key={d} className="relative border-t border-border first:border-t-0">
            <div className="num pointer-events-none absolute right-0 top-1 flex items-baseline gap-1.5 text-[10px]">
              <span className="font-medium text-fg-muted">D{d}</span>
              {amp !== null && amp > 1.15 && Number.isFinite(amp) && <span className="text-fg-faint">×{amp.toFixed(amp > 10 ? 0 : 1)}</span>}
            </div>
            <svg width="100%" viewBox={`0 0 ${W} ${height}`} className="block overflow-visible">
              <line x1={padL} x2={W - 6} y1={sy(0)} y2={sy(0)} stroke="var(--border-strong)" strokeDasharray="2 3" opacity={y0 < 0 && y1 > 0 ? 1 : 0} />
              {ps.length > 1 && (
                <polyline
                  fill="none"
                  stroke="var(--fg-faint)"
                  strokeWidth={1}
                  points={ps
                    .slice()
                    .sort((a, b) => a.year - b.year)
                    .map((p) => `${sx(p.year)},${sy(p.flux_ujy)}`)
                    .join(" ")}
                />
              )}
              {ps.map((p) => (
                <g key={`${p.epoch}-${p.detector}`} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}>
                  <line x1={sx(p.year)} x2={sx(p.year)} y1={sy(p.flux_ujy - p.eflux_ujy)} y2={sy(p.flux_ujy + p.eflux_ujy)} stroke="var(--fg-muted)" strokeWidth={1.25} />
                  <circle
                    cx={sx(p.year)}
                    cy={sy(p.flux_ujy)}
                    r={hover === p ? 4.5 : 3.25}
                    fill={p.full_coverage === false ? "var(--bg-elev)" : "var(--accent)"}
                    stroke={p.full_coverage === false ? "var(--accent)" : "var(--bg-elev)"}
                    strokeWidth={1.5}
                  />
                  <rect x={sx(p.year) - 8} y={0} width={16} height={height} fill="transparent" />
                </g>
              ))}
              <text x={padL - 4} y={sy(y1) + 8} textAnchor="end" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">
                {fmtFlux(y1)}
              </text>
              <text x={padL - 4} y={sy(y0)} textAnchor="end" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">
                {fmtFlux(y0)}
              </text>
            </svg>
            {wl && <span className="sr-only">{wl} µm</span>}
          </div>
        );
      })}
      <svg width="100%" viewBox={`0 0 ${W} 14`} className="block">
        {ticks.map((t) => (
          <text key={t} x={sx(t)} y={11} textAnchor="middle" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">
            {t.toFixed(1)}
          </text>
        ))}
      </svg>
      <div className="num mt-1 flex justify-between text-[10px] text-fg-faint">
        <span>{points.some((p) => p.method === "wing") ? "wing flux (relative)" : "flux density (µJy)"}</span>
        <span>year</span>
      </div>
      {hover && (
        <div className="num pointer-events-none absolute right-0 top-0 z-10 rounded-md border border-border-strong bg-bg-elev px-2 py-1 text-[11px] shadow-lg">
          <div>
            D{hover.detector} · {hover.year.toFixed(3)}
          </div>
          <div className="text-fg">
            {fmtFlux(hover.flux_ujy)} ± {fmtFlux(hover.eflux_ujy)} {hover.method === "wing" ? "(relative)" : "µJy"}
          </div>
          {hover.wave_min_um && (
            <div className="text-fg-faint">
              {hover.wave_min_um.toFixed(2)}–{hover.wave_max_um?.toFixed(2)} µm · {hover.n} exp
              {hover.full_coverage === false ? " · partial coverage" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function fmtFlux(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 10) return v.toFixed(0);
  return v.toFixed(1);
}

/** Measured vs Gaia DR3 total proper motion. One series + the y = x line. */
export function GaiaScatter({ rows }: { rows: { pm: number; gaia_pm: number; epm: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 248;
  const H = 168;
  const pad = 30;
  const max = useMemo(() => Math.max(500, ...rows.map((r) => Math.max(r.pm, r.gaia_pm))) * 1.08, [rows]);
  // sqrt scale so a 10″/yr star and the 0.1″/yr field are both readable
  const s = (v: number) => Math.sqrt(Math.max(v, 0) / max);
  const sx = (v: number) => pad + s(v) * (W - pad - 6);
  const sy = (v: number) => H - pad + 4 - s(v) * (H - pad - 4);
  const ticks = [0, 1000, 5000, 10000].filter((t) => t <= max);
  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={sy(0)} y2={sy(max)} stroke="var(--border)" />
            <line x1={sx(0)} x2={sx(max)} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
            <text x={sx(t)} y={H - pad + 16} textAnchor="middle" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">
              {t / 1000}
            </text>
            <text x={pad - 5} y={sy(t) + 3} textAnchor="end" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">
              {t / 1000}
            </text>
          </g>
        ))}
        <line x1={sx(0)} y1={sy(0)} x2={sx(max)} y2={sy(max)} stroke="var(--fg-faint)" strokeDasharray="3 3" />
        {rows.map((r, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <line x1={sx(r.gaia_pm)} x2={sx(r.gaia_pm)} y1={sy(Math.max(r.pm - r.epm, 0))} y2={sy(r.pm + r.epm)} stroke="var(--fg-faint)" strokeWidth={1} opacity={0.5} />
            <circle cx={sx(r.gaia_pm)} cy={sy(r.pm)} r={hover === i ? 4.5 : r.gaia_pm > 1000 ? 4 : 2.25} fill={r.gaia_pm > 1000 ? "var(--accent)" : "var(--fg-muted)"} stroke="var(--bg-elev)" strokeWidth={1} />
            <circle cx={sx(r.gaia_pm)} cy={sy(r.pm)} r={8} fill="transparent" />
          </g>
        ))}
        <text x={W - 6} y={H - 2} textAnchor="end" fontSize={9.5} fill="var(--fg-muted)">Gaia DR3 μ (″/yr)</text>
        <text x={4} y={10} fontSize={9.5} fill="var(--fg-muted)">Blink μ (″/yr)</text>
      </svg>
      {hover !== null && (
        <div className="num pointer-events-none absolute left-10 top-3 rounded-md border border-border-strong bg-bg-elev px-2 py-1 text-[11px] shadow-lg">
          Blink {(rows[hover].pm / 1000).toFixed(2)} ± {(rows[hover].epm / 1000).toFixed(2)}″/yr · Gaia {(rows[hover].gaia_pm / 1000).toFixed(2)}″/yr
        </div>
      )}
    </div>
  );
}
