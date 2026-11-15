"use client";
import { Cpu, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { decodeF32 } from "@/lib/image";
import type { Candidate, Candidates, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Section } from "./display-panel";
import { fmtPm } from "./motion-panel";

/** A / B / B−A thumbnail triplet from a candidate's stamp (all-detector channels 0–2). */
export function StampTriplet({ stamp, size = 42 }: { stamp: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const a = decodeF32(stamp);
    const S = 21;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(S * 3 + 2, S);
    for (let ch = 0; ch < 3; ch++) {
      const off = ch * S * S;
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const v = a[off + (S - 1 - y) * S + x];
          const p = (y * (S * 3 + 2) + ch * (S + 1) + x) * 4;
          if (ch < 2) {
            const t = Math.max(0, Math.min(1, (Math.asinh(v / 3) + 0.4) / 5.5));
            img.data[p] = img.data[p + 1] = img.data[p + 2] = t * 255;
          } else {
            const t = Math.max(0, Math.min(1, Math.asinh(Math.abs(v) / 2) / 3));
            const col = v < 0 ? [0, 150, 255] : [255, 105, 0];
            img.data[p] = 12 + t * (col[0] - 12);
            img.data[p + 1] = 12 + t * (col[1] - 12);
            img.data[p + 2] = 14 + t * (col[2] - 14);
          }
          img.data[p + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
  }, [stamp]);
  return (
    <canvas
      ref={ref}
      width={21 * 3 + 2}
      height={21}
      className="pixelated rounded-[3px] bg-black"
      style={{ width: size * 3 + 4, height: size }}
      aria-label="Stamps: epoch A, epoch B, difference"
    />
  );
}

export function CandidatesPanel({
  data,
  loading,
  error,
  browserState,
  selectedRank,
  onSelect,
  sources,
}: {
  data: Candidates | null;
  loading: boolean;
  error: string | null;
  browserState: "idle" | "running" | "done" | "error";
  selectedRank: number | null;
  onSelect: (c: Candidate) => void;
  sources: Map<number, Source>;
}) {
  if (loading || (!data && !error))
    return (
      <div className="flex items-center gap-2 p-4 text-[12px] text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" /> Scoring candidates…
      </div>
    );
  if (error || !data) return <div className="p-4 text-[12px] text-fg-muted">ML candidates unavailable: {error}</div>;
  const thr = data.threshold ?? 0.5;
  const list = data.candidates.filter((c) => c.stamp).slice(0, 40);
  const above = data.candidates.filter((c) => (c.browserScore ?? c.score) >= thr).length;
  return (
    <div>
      <Section
        title="Mover candidates"
        aside={
          <span className="flex items-center gap-1 text-[10px] text-fg-faint" title="Scores re-computed in your browser with onnxruntime-web">
            {browserState === "running" ? <Loader2 className="size-3 animate-spin" /> : <Cpu className="size-3" />}
            {browserState === "done" ? "scored in browser" : browserState === "error" ? "server scores" : "…"}
          </span>
        }
      >
        <p className="mb-2 text-[11px] leading-4 text-fg-faint">
          {above} of {data.candidates.length} candidates score ≥ {thr} with the CNN on epochs{" "}
          {data.pair ? `${data.pair.a_year.toFixed(2)} → ${data.pair.b_year.toFixed(2)}` : ""}. These are{" "}
          <b className="text-fg-muted">candidates</b>, not discoveries.
        </p>
        <ul className="-mx-2 space-y-0.5">
          {list.map((c) => {
            const sc = c.browserScore ?? c.score;
            const src = c.source_id !== undefined ? sources.get(c.source_id) : undefined;
            return (
              <li key={c.rank}>
                <button
                  onClick={() => onSelect(c)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                    selectedRank === c.rank ? "bg-accent-soft" : "hover:bg-fg/[0.05]",
                  )}
                >
                  {c.stamp && <StampTriplet stamp={c.stamp} size={20} />}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="num text-[12px]">{sc.toFixed(2)}</span>
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-fg/10">
                        <span
                          className={cn("block h-full rounded-full", sc >= thr ? "bg-accent" : "bg-fg-faint")}
                          style={{ width: `${Math.round(sc * 100)}%` }}
                        />
                      </span>
                    </span>
                    <span className="num block truncate text-[10px] text-fg-faint">
                      #{c.rank} · {c.kind === "dipole" ? "difference dipole" : `source #${c.source_id}`}
                      {src?.pm !== undefined && (src.pm_sig ?? 0) >= 3 ? ` · ${fmtPm(src.pm)}″/yr` : ""}
                      {c.gaia_pm != null ? ` · Gaia ${fmtPm(c.gaia_pm)}″/yr` : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-fg-faint">
          <Sparkles className="size-3" /> Stamps: epoch A · epoch B · difference (blue = brighter in A, orange = in B)
        </div>
      </Section>
    </div>
  );
}

/** Position vs time with the linear motion fit (two small panels: RA offset, Dec offset), arcsec. */
export function MotionFit({ source, pixelScale }: { source: Source; pixelScale: number }) {
  const tr = source.track ?? [];
  if (tr.length < 2 || source.pmra === undefined) return null;
  const t0 = source.t_ref ?? 2026;
  const W = 248;
  const Hh = 64;
  const padL = 32;
  const xs = tr.map((p) => p.year);
  // leave room for the panel label above the data
  const x0 = Math.min(...xs) - 0.05;
  const x1 = Math.max(...xs) + 0.05;
  const sx = (y: number) => padL + ((y - x0) / (x1 - x0)) * (W - padL - 6);
  const panels = [
    { label: "ΔRA·cosδ", off: tr.map((p) => -(p.x - source.x) * pixelScale), err: tr.map((p) => p.ex * pixelScale), slope: (source.pmra ?? 0) / 1000 },
    { label: "ΔDec", off: tr.map((p) => (p.y - source.y) * pixelScale), err: tr.map((p) => p.ey * pixelScale), slope: (source.pmdec ?? 0) / 1000 },
  ];
  return (
    <div>
      {panels.map((pn) => {
        const lo = Math.min(...pn.off.map((v, i) => v - pn.err[i]), pn.slope * (x0 - t0), pn.slope * (x1 - t0)) - 0.3;
        const hi = Math.max(...pn.off.map((v, i) => v + pn.err[i]), pn.slope * (x0 - t0), pn.slope * (x1 - t0)) + 0.3;
        const sy = (v: number) => 14 + (1 - (v - lo) / (hi - lo)) * (Hh - 18);
        return (
          <div key={pn.label} className="relative border-t border-border first:border-t-0">
            <span className="num absolute left-0 top-0 text-[10px] text-fg-muted">{pn.label} (″)</span>
            <svg width="100%" viewBox={`0 0 ${W} ${Hh}`} className="block">
              <line x1={sx(x0)} x2={sx(x1)} y1={sy(pn.slope * (x0 - t0))} y2={sy(pn.slope * (x1 - t0))} stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="4 3" />
              {pn.off.map((v, i) => (
                <g key={i}>
                  <line x1={sx(tr[i].year)} x2={sx(tr[i].year)} y1={sy(v - pn.err[i])} y2={sy(v + pn.err[i])} stroke="var(--fg-muted)" />
                  <circle cx={sx(tr[i].year)} cy={sy(v)} r={3} fill="var(--fg)" stroke="var(--bg-elev)" strokeWidth={1.5} />
                </g>
              ))}
              <text x={padL - 4} y={sy(hi) + 8} textAnchor="end" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">
                {hi.toFixed(1)}
              </text>
              <text x={padL - 4} y={sy(lo)} textAnchor="end" fontSize={9} fill="var(--fg-faint)" fontFamily="var(--font-mono)">
                {lo.toFixed(1)}
              </text>
            </svg>
          </div>
        );
      })}
      <div className="num flex justify-between pl-8 text-[10px] text-fg-faint">
        <span>{x0.toFixed(1)}</span>
        <span>year</span>
        <span>{x1.toFixed(1)}</span>
      </div>
    </div>
  );
}
