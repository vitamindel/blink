"use client";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtFlux } from "@/components/charts";
import { API_BASE } from "@/lib/api";
import type { Source } from "@/lib/types";
import { Section } from "./display-panel";

interface SpecPoint {
  wave_um: number;
  width_um: number;
  flux_ujy: number;
  eflux_ujy: number;
  n: number;
}
interface SpecResult {
  spectrum: SpecPoint[];
  n_exposures: number;
  saturated: boolean;
  classification: {
    label: string;
    family: string | null;
    best?: string;
    probabilities?: Record<string, number>;
    reduced_chi2?: Record<string, number>;
    best_templates?: Record<string, string>;
    top_brown_dwarf_types?: { type: string; reduced_chi2: number }[];
    regions?: { region: string; physics: string; delta_chi2: number; favours: string }[];
    indices?: Record<string, number | null>;
    models?: Record<string, (number | null)[] | null>;
    caveats?: string[];
  };
}

const FAMILY: Record<string, string> = {
  brown_dwarf: "Brown dwarf",
  star: "Star",
  galaxy_qso: "Galaxy / QSO",
  solar_system: "Solar-system object",
};

const BANDS: [number, number, string][] = [
  [1.3, 1.5, "H₂O"],
  [1.6, 1.75, "CH₄"],
  [1.8, 2.05, "H₂O"],
  [3.15, 3.5, "CH₄"],
  [4.5, 4.8, "CO"],
];

export function SpectrumSection({ source, req }: { source: Source; req: { target?: string; ra?: number; dec?: number } }) {
  const [res, setRes] = useState<SpecResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    setRes(null);
    setErr(null);
    setBusy(true);
    const moving = (source.pm_sig ?? 0) >= 5;
    const q = new URLSearchParams();
    if (req.target) q.set("target", req.target);
    if (req.ra !== undefined && req.dec !== undefined) {
      q.set("ra", String(req.ra));
      q.set("dec", String(req.dec));
    }
    q.set("sra", source.ra.toFixed(6));
    q.set("sdec", source.dec.toFixed(6));
    q.set("pmra", (moving ? source.pmra ?? 0 : 0).toFixed(1));
    q.set("pmdec", (moving ? source.pmdec ?? 0 : 0).toFixed(1));
    q.set("t_ref", (source.t_ref ?? 2026).toFixed(3));
    fetch(`${API_BASE}/api/spectrum?${q}`, { signal: ac.signal })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`))))
      .then(setRes)
      .catch((e) => !ac.signal.aborted && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => !ac.signal.aborted && setBusy(false));
    return () => ac.abort();
  }, [source, req.target, req.ra, req.dec]);

  const c = res?.classification;
  const fams = c?.probabilities ? Object.entries(c.probabilities).sort((a, b) => b[1] - a[1]) : [];
  const runnerUp = fams[1]?.[0];
  return (
    <>
      <Section title="Spectrum" aside={busy ? <Loader2 className="size-3.5 animate-spin text-fg-faint" /> : null}>
        {err && <p className="text-[12px] text-danger">{err}</p>}
        {res && res.spectrum.length > 0 && (
          <SpectrumChart spec={res.spectrum} best={c?.family ? c.models?.[c.family] ?? null : null} alt={runnerUp ? c?.models?.[runnerUp] ?? null : null} />
        )}
        {res && (
          <p className="mt-1.5 text-[11px] leading-4 text-fg-faint">
            Forced ePSF photometry in {res.n_exposures} exposures, each at its own wavelength (WCS-WAVE), combined into{" "}
            {res.spectrum.length} SPHEREx channels.
            {c?.family && (
              <>
                {" "}
                <span className="text-accent">━</span> best {FAMILY[c.family]} fit
                {runnerUp && (
                  <>
                    , <span className="text-fg-muted">┅</span> best {FAMILY[runnerUp]}
                  </>
                )}
                .
              </>
            )}
          </p>
        )}
      </Section>
      {c && (
        <Section title="What is it?">
          <div className="text-[15px] font-medium leading-tight">{c.label}</div>
          {fams.length > 0 && (
            <ul className="mt-2.5 space-y-1">
              {fams.map(([f, p]) => (
                <li key={f} className="flex items-center gap-2 text-[12px]">
                  <span className="w-[92px] shrink-0 text-fg-muted">{FAMILY[f] ?? f}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/10">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(1, p * 100)}%`, opacity: f === c.family ? 1 : 0.45 }} />
                  </span>
                  <span className="num w-9 text-right text-fg-faint">{(p * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
          {c.family === "brown_dwarf" && c.top_brown_dwarf_types && (
            <p className="num mt-2 text-[11px] text-fg-faint">
              Closest templates: {c.top_brown_dwarf_types.slice(0, 3).map((t) => `${t.type} (χ²ᵥ ${t.reduced_chi2.toFixed(1)})`).join(", ")}
            </p>
          )}
          {c.regions && c.regions.length > 0 && (
            <>
              <h4 className="mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-faint">Why</h4>
              <ul className="mt-1.5 space-y-1 text-[12px]">
                {c.regions.slice(0, 4).map((r) => (
                  <li key={r.region} className="leading-4">
                    <div className="flex justify-between gap-2">
                      <span className="text-fg-muted">{r.physics}</span>
                      <span className="num shrink-0 text-fg-faint">{r.region}</span>
                    </div>
                    <div className="num text-[11px] text-fg-faint">
                      → <span className="text-fg">{FAMILY[r.favours] ?? r.favours}</span> · Δχ² {Math.abs(r.delta_chi2).toFixed(0)}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {c.indices && (
            <dl className="num mt-3 grid grid-cols-[1fr_auto] gap-y-0.5 text-[11px]">
              {c.indices.water_1p4 != null && (
                <>
                  <dt className="text-fg-faint">Water 1.4 µm (f/f_J; &lt;0.6 = deep)</dt>
                  <dd>{c.indices.water_1p4.toFixed(2)}</dd>
                </>
              )}
              {c.indices.methane_3p3 != null && (
                <>
                  <dt className="text-fg-faint">Methane 3.3 µm depth (&lt;0.7 = T/Y)</dt>
                  <dd>{c.indices.methane_3p3.toFixed(2)}</dd>
                </>
              )}
              {c.indices.peak_4p5_over_1p25 != null && (
                <>
                  <dt className="text-fg-faint">f(4.5 µm) / f(1.25 µm)</dt>
                  <dd>{c.indices.peak_4p5_over_1p25.toFixed(2)}</dd>
                </>
              )}
            </dl>
          )}
          {c.caveats?.map((cv) => (
            <p key={cv} className="mt-2 text-[11px] leading-4 text-fg-faint">
              ⚠ {cv}
            </p>
          ))}
        </Section>
      )}
    </>
  );
}

function SpectrumChart({ spec, best, alt }: { spec: SpecPoint[]; best: (number | null)[] | null; alt: (number | null)[] | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 248;
  const H = 150;
  const padL = 34;
  const padB = 18;
  const lo = Math.min(...spec.map((s) => s.flux_ujy - s.eflux_ujy), 0);
  const hi = Math.max(...spec.map((s) => s.flux_ujy + s.eflux_ujy)) * 1.08;
  const sx = (l: number) => padL + ((l - 0.7) / (5.05 - 0.7)) * (W - padL - 4);
  const sy = (v: number) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - padB - 6);
  const line = (m: (number | null)[]) =>
    m
      .map((v, i) => (v === null ? null : `${sx(spec[i].wave_um)},${sy(v)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block overflow-visible">
        {BANDS.map(([a, b, l]) => (
          <g key={a}>
            <rect x={sx(a)} y={4} width={sx(b) - sx(a)} height={H - padB - 6} fill="var(--fg)" opacity={0.04} />
            <text x={(sx(a) + sx(b)) / 2} y={12} fontSize={8} textAnchor="middle" fill="var(--fg-faint)">
              {l}
            </text>
          </g>
        ))}
        {[1, 2, 3, 4, 5].map((t) => (
          <text key={t} x={sx(t)} y={H - 4} fontSize={9} textAnchor="middle" fill="var(--fg-faint)" fontFamily="var(--font-mono)">
            {t}
          </text>
        ))}
        <text x={padL - 4} y={sy(hi) + 8} fontSize={9} textAnchor="end" fill="var(--fg-faint)" fontFamily="var(--font-mono)">
          {fmtFlux(hi)}
        </text>
        <text x={padL - 4} y={sy(Math.max(lo, 0))} fontSize={9} textAnchor="end" fill="var(--fg-faint)" fontFamily="var(--font-mono)">
          {fmtFlux(Math.max(lo, 0))}
        </text>
        {alt && <polyline fill="none" stroke="var(--fg-muted)" strokeWidth={1.25} strokeDasharray="3 3" points={line(alt)} />}
        {spec.map((s, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <line x1={sx(s.wave_um)} x2={sx(s.wave_um)} y1={sy(s.flux_ujy - s.eflux_ujy)} y2={sy(s.flux_ujy + s.eflux_ujy)} stroke="var(--fg-faint)" />
            <circle cx={sx(s.wave_um)} cy={sy(s.flux_ujy)} r={hover === i ? 3 : 1.75} fill="var(--fg)" />
            <rect x={sx(s.wave_um) - 1.5} y={0} width={3} height={H - padB} fill="transparent" />
          </g>
        ))}
        {best && <polyline fill="none" stroke="var(--accent)" strokeWidth={1.75} points={line(best)} />}
      </svg>
      <div className="num flex justify-between text-[10px] text-fg-faint">
        <span>f_ν (µJy)</span>
        <span>wavelength (µm)</span>
      </div>
      {hover !== null && (
        <div className="num pointer-events-none absolute right-0 top-4 rounded-md border border-border-strong bg-bg-elev px-2 py-1 text-[11px] shadow-lg">
          {spec[hover].wave_um.toFixed(3)} µm · {fmtFlux(spec[hover].flux_ujy)} ± {fmtFlux(spec[hover].eflux_ujy)} µJy · {spec[hover].n} exp
        </div>
      )}
    </div>
  );
}
