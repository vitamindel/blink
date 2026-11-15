"use client";
import { useEffect, useRef, useState } from "react";
import { EPS_INDI_B_CHI2 as CHI2, EPS_INDI_B_SPECTRUM as D } from "./spectrum-data";

const X0 = 0.7;
const X1 = 5.05;
const Y1 = 60;
const M = { l: 34, r: 10, t: 26, b: 44 };
const BANDS = [
  { a: 1.33, b: 1.5, label: "H₂O" },
  { a: 1.8, b: 2.05, label: "H₂O" },
  { a: 3.15, b: 3.55, label: "CH₄" },
];
const BD = "#3b8fe6";
const STAR = "#e5661f";

function linePath(col: 3 | 4, sx: (v: number) => number, sy: (v: number) => number) {
  let d = "";
  let pen = false;
  for (const r of D) {
    const v = r[col];
    if (v == null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(r[0]).toFixed(1)} ${sy(Math.min(v, Y1)).toFixed(1)}`;
    pen = true;
  }
  return d;
}

/** ε Indi B's SPHEREx spectrum with the best brown-dwarf and best star fits, from the cached spectrum product. */
export function SpectrumChart() {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const h = Math.round(Math.min(380, Math.max(260, w * 0.62)));
  const sx = (v: number) => M.l + ((v - X0) / (X1 - X0)) * (w - M.l - M.r);
  const sy = (v: number) => M.t + (1 - v / Y1) * (h - M.t - M.b);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < D.length; i++) if (Math.abs(sx(D[i][0]) - px) < Math.abs(sx(D[best][0]) - px)) best = i;
    setHover(best);
  };
  const hv = hover == null ? null : D[hover];

  return (
    <div>
      <div className="home-legend">
        <span>
          <i className="dot" style={{ background: "rgb(232,238,248)" }} />ε Indi B, SPHEREx
        </span>
        <span>
          <i className="ln" style={{ background: BD }} />
          Brown dwarf (T2) · χ²/dof {CHI2.brownDwarf}
        </span>
        <span>
          <i className="ln dash" style={{ color: STAR }} />
          Best star · χ²/dof {CHI2.star}
        </span>
      </div>
      <div ref={box} className="relative mt-3">
        <svg
          width={w}
          height={h}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`Spectrum of epsilon Indi B from 0.75 to 5 microns: a brown-dwarf template fits with reduced chi-squared ${CHI2.brownDwarf}, the best star ${CHI2.star}.`}
        >
          {BANDS.map((b, i) => (
            <g key={i}>
              <rect x={sx(b.a)} y={M.t} width={sx(b.b) - sx(b.a)} height={h - M.t - M.b} fill="rgba(173,220,255,0.06)" />
              <text x={(sx(b.a) + sx(b.b)) / 2} y={M.t - 8} textAnchor="middle" className="home-axis">
                {b.label}
              </text>
            </g>
          ))}
          {[0, 20, 40, 60].map((v) => (
            <g key={v}>
              <line x1={M.l} x2={w - M.r} y1={sy(v)} y2={sy(v)} stroke="rgba(232,238,248,0.08)" />
              <text x={M.l - 8} y={sy(v) + 4} textAnchor="end" className="home-axis">
                {v}
              </text>
            </g>
          ))}
          {[1, 2, 3, 4, 5].map((v) => (
            <text key={v} x={sx(v)} y={h - M.b + 18} textAnchor="middle" className="home-axis">
              {v}
            </text>
          ))}
          <text x={M.l - 8} y={M.t - 8} textAnchor="end" className="home-axis">
            mJy
          </text>
          <text x={(M.l + w - M.r) / 2} y={h - 6} textAnchor="middle" className="home-axis">
            Wavelength (µm)
          </text>

          <path d={linePath(4, sx, sy)} fill="none" stroke={STAR} strokeWidth={2} strokeDasharray="5 4" className="fade" />
          <path d={linePath(3, sx, sy)} fill="none" stroke={BD} strokeWidth={2} pathLength={1} className="draw" />
          <g className="fade">
            {D.map((r, i) => (
              <g key={i}>
                <line
                  x1={sx(r[0])}
                  x2={sx(r[0])}
                  y1={sy(Math.max(0, r[1] - r[2]))}
                  y2={sy(Math.min(Y1, r[1] + r[2]))}
                  stroke="rgba(232,238,248,0.35)"
                />
                <circle cx={sx(r[0])} cy={sy(Math.min(Math.max(r[1], 0), Y1))} r={2.4} fill="rgb(232,238,248)" />
              </g>
            ))}
          </g>
          {hv && (
            <g pointerEvents="none">
              <line x1={sx(hv[0])} x2={sx(hv[0])} y1={M.t} y2={h - M.b} stroke="rgba(232,238,248,0.35)" />
              <circle cx={sx(hv[0])} cy={sy(Math.min(Math.max(hv[1], 0), Y1))} r={4.5} fill="#fff" stroke="#000" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hv && (
          <div
            className="home-tip"
            style={{ left: Math.min(Math.max(sx(hv[0]) + 12, 0), w - 190), top: Math.max(sy(Math.min(hv[1], Y1)) - 70, 0) }}
          >
            <div className="font-medium text-white">
              {hv[0].toFixed(2)} µm · {hv[1].toFixed(1)} ± {hv[2].toFixed(1)} mJy
            </div>
            {hv[3] != null && (
              <div>
                <i className="ln" style={{ background: BD }} /> T2 template {hv[3].toFixed(1)}
              </div>
            )}
            {hv[4] != null && (
              <div>
                <i className="ln dash" style={{ color: STAR }} /> star {hv[4].toFixed(1)}
              </div>
            )}
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>ε Indi B SPHEREx spectrum</caption>
        <thead>
          <tr>
            <th>Wavelength (µm)</th>
            <th>Flux (mJy)</th>
            <th>Error (mJy)</th>
          </tr>
        </thead>
        <tbody>
          {D.map((r) => (
            <tr key={r[0]}>
              <td>{r[0]}</td>
              <td>{r[1]}</td>
              <td>{r[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
