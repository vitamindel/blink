"use client";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { GaiaScatter, LightCurveMultiples } from "@/components/charts";
import { loadPhotometry } from "@/lib/api";
import type { Analysis, Photometry, Source } from "@/lib/types";
import { cn, fmtDec, fmtRA } from "@/lib/utils";
import { Section } from "./display-panel";

export const fmtPm = (mas?: number | null) => (mas === undefined || mas === null ? "—" : `${(mas / 1000).toFixed(2)}`);

export function MotionPanel({
  analysis,
  loading,
  selected,
  onSelect,
}: {
  analysis: Analysis | null;
  loading: boolean;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  if (!analysis)
    return (
      <div className="flex items-center gap-2 p-4 text-[12px] text-fg-muted">
        {loading && <Loader2 className="size-3.5 animate-spin" />}
        {loading ? "Measuring positions in every epoch…" : "Motion analysis unavailable for this field."}
      </div>
    );
  const byId = new Map(analysis.sources.map((s) => [s.id, s]));
  const movers = analysis.movers.map((i) => byId.get(i)!).filter(Boolean);
  const g = analysis.gaia_comparison;
  const measured = analysis.sources.filter((s) => s.pm !== undefined && s.n_epochs >= 3).length;
  return (
    <div>
      <Section title="Significant proper motions" aside={<span className="num text-[11px] text-fg-faint">≥5σ</span>}>
        {movers.length === 0 ? (
          <p className="text-[12px] text-fg-muted">
            None of the {measured} sources with ≥3 epochs moves significantly. SPHEREx’s 6.2″ pixels and ~1 yr baseline
            limit this to roughly &gt;1″/yr for bright stars.
          </p>
        ) : (
          <ul className="-mx-2 space-y-0.5">
            {movers.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                    selected === s.id ? "bg-accent-soft" : "hover:bg-fg/[0.05]",
                  )}
                >
                  <ArrowUpRight className="size-3.5 shrink-0 text-accent" style={{ transform: `rotate(${pa(s) - 45}deg)` }} />
                  <span className="flex-1">
                    <span className="num block text-[12px]">
                      {fmtPm(s.pm)} ± {fmtPm(s.epm)}″/yr
                    </span>
                    <span className="num block text-[10px] text-fg-faint">
                      #{s.id} · {s.pm_sig?.toFixed(1)}σ · {s.n_epochs} epochs{s.detectors === "D4–D6" ? " · red" : ""}
                    </span>
                  </span>
                  {s.gaia?.pm != null && (
                    <span className="num text-right text-[10px] text-fg-faint">
                      Gaia
                      <br />
                      {fmtPm(s.gaia.pm)}″/yr
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {(analysis.rejected_by_gaia?.length ?? 0) > 0 && (
        <Section title="Rejected by Gaia">
          <ul className="-mx-2 space-y-0.5">
            {analysis.rejected_by_gaia!.map((i) => byId.get(i)!).filter(Boolean).map((s) => (
              <li key={s.id}>
                <button onClick={() => onSelect(s.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-fg/[0.05]">
                  <span className="num flex-1 text-[11px] text-fg-muted">
                    #{s.id} · {fmtPm(s.pm)}″/yr ({s.pm_sig?.toFixed(1)}σ)
                  </span>
                  <span className="num text-[10px] text-fg-faint">Gaia {fmtPm(s.gaia?.pm)}″/yr</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] leading-4 text-fg-faint">
            Passed our 5σ cut but Gaia DR3 measures these stars as near-static: Blink’s systematics (edges, blends, PSF
            rotation). Kept visible so the false-positive rate is honest.
          </p>
        </Section>
      )}
      <Section title="Check against Gaia DR3">
        {g.n > 0 && g.scatter ? (
          <>
            <GaiaScatter rows={g.scatter} />
            <dl className="num mt-2 grid grid-cols-[1fr_auto] gap-y-0.5 text-[11px]">
              <dt className="text-fg-faint">Matched stars</dt>
              <dd>{g.n}</dd>
              <dt className="text-fg-faint">Robust scatter Blink − Gaia</dt>
              <dd>{((g.robust_scatter_mas_yr ?? 0) / 1000).toFixed(2)}″/yr</dd>
              <dt className="text-fg-faint">Median offset (μα*, μδ)</dt>
              <dd>
                {((g.median_dpmra ?? 0) / 1000).toFixed(2)}, {((g.median_dpmdec ?? 0) / 1000).toFixed(2)}″/yr
              </dd>
            </dl>
          </>
        ) : (
          <p className="text-[12px] text-fg-muted">No Gaia matches.</p>
        )}
      </Section>
      <Section title="Astrometry">
        <p className="text-[11px] leading-4 text-fg-faint">
          ePSF fits in each detector’s epoch coadd, frame-to-frame offsets removed with field stars (≤
          {Math.max(...analysis.epochs.map((e) => Math.hypot(...e.offset_px))).toFixed(3)} px), weighted linear fit with a{" "}
          {analysis.sys_px} px floor; errors scaled by √χ²ᵥ.
        </p>
      </Section>
    </div>
  );
}

/** Position angle of motion, degrees east of north. */
export function pa(s: Source) {
  return ((Math.atan2(s.pmra ?? 0, s.pmdec ?? 0) * 180) / Math.PI + 360) % 360;
}

export function SourcePanel({
  source,
  req,
  onClose,
}: {
  source: Source | null;
  req: { target?: string; ra?: number; dec?: number };
  onClose: () => void;
}) {
  const [phot, setPhot] = useState<Photometry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!source) return;
    const ac = new AbortController();
    setPhot(null);
    setErr(null);
    setBusy(true);
    const moving = (source.pm_sig ?? 0) >= 5;
    loadPhotometry(
      req,
      { ra: source.ra, dec: source.dec, pmra: moving ? source.pmra : 0, pmdec: moving ? source.pmdec : 0, t_ref: source.t_ref },
      ac.signal,
    )
      .then(setPhot)
      .catch((e) => !ac.signal.aborted && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => !ac.signal.aborted && setBusy(false));
    return () => ac.abort();
  }, [source, req.target, req.ra, req.dec]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source) return <div className="p-4 text-[12px] text-fg-muted">Click a source on the sky, or a mover in the list.</div>;
  return (
    <div>
      <Section
        title={`Source #${source.id}`}
        aside={
          <button className="text-[11px] text-fg-faint hover:text-fg" onClick={onClose}>
            clear
          </button>
        }
      >
        <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
          <dt className="text-fg-faint">RA</dt>
          <dd className="text-right">{fmtRA(source.ra)}</dd>
          <dt className="text-fg-faint">Dec</dt>
          <dd className="text-right">{fmtDec(source.dec)}</dd>
          <dt className="text-fg-faint">S/N (deep)</dt>
          <dd className="text-right">{source.snr.toFixed(0)}{source.saturated ? " · saturated" : ""}</dd>
          {source.pm !== undefined && (
            <>
              <dt className="text-fg-faint">μα*, μδ</dt>
              <dd className="text-right">
                {fmtPm(source.pmra)}, {fmtPm(source.pmdec)}″/yr
              </dd>
              <dt className="text-fg-faint">|μ|</dt>
              <dd className="text-right">
                {fmtPm(source.pm)} ± {fmtPm(source.epm)}″/yr ({source.pm_sig?.toFixed(1)}σ)
              </dd>
            </>
          )}
          {source.gaia && (
            <>
              <dt className="text-fg-faint">Gaia DR3</dt>
              <dd className="text-right">
                G {source.gaia.g?.toFixed(1)} · {fmtPm(source.gaia.pm)}″/yr
              </dd>
            </>
          )}
        </dl>
        {source.replaced && <p className="mt-2 text-[11px] text-fg-faint">{source.replaced}.</p>}
      </Section>
      <Section title="Light curve" aside={busy ? <Loader2 className="size-3.5 animate-spin text-fg-faint" /> : null}>
        {err && <p className="text-[12px] text-danger">{err}</p>}
        {phot && <LightCurveMultiples points={phot.lightcurve} />}
        {phot && (
          <p className="mt-2 text-[11px] leading-4 text-fg-faint">
            Forced ePSF photometry per epoch × detector{(source.pm_sig ?? 0) >= 5 ? ", following the fitted motion" : ""}. Each
            panel has its own scale; ×N = max/min. Hollow points are short visits that sample only part of the
            detector’s wavelength range — for steep spectra (brown dwarfs) that alone changes the flux.
            {phot.saturated && " Saturated core: relative annulus (wing) photometry, not calibrated to µJy."}
          </p>
        )}
      </Section>
    </div>
  );
}
