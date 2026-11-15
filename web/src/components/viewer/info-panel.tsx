"use client";
import { AlertTriangle, CheckCircle2, Database } from "lucide-react";
import { useMemo } from "react";
import type { BandKey, EpochFrame, Flipbook } from "@/lib/types";
import { cn, fmtDec, fmtRA } from "@/lib/utils";
import { Section } from "./display-panel";
import { SkyContext } from "./sky-context";

const FLAG_HELP: Record<string, string> = {
  GHOST: "Optical ghost from a bright source in the exposure",
  GHOST_FPA: "Ghost from a bright source on another detector",
  GHOST_EXT: "Ghost from a bright source outside the field",
  STREAK: "Satellite or other streak",
  BLOOM: "Charge bloom from a saturated star",
  SNOWBALL: "Cosmic-ray ‘snowball’ artifact",
  HALO: "Transient halo",
  CROSSTALK: "Electronic crosstalk",
  SATELLITE_HALO: "Halo around a satellite streak",
};

export function InfoPanel({
  fb,
  epoch,
  band,
  source,
}: {
  fb: Flipbook | null;
  epoch: EpochFrame | null;
  band: BandKey;
  source: "api" | "static" | null;
}) {
  const exps = useMemo(() => {
    if (!fb || !epoch) return [];
    return fb.exposures.filter(
      (x) =>
        x.mjd >= epoch.mjd_start - 1e-6 &&
        x.mjd <= epoch.mjd_end + 1e-6 &&
        (band === "all" || x.detector === Number(band[1])),
    );
  }, [fb, epoch, band]);

  const qa = useMemo(() => {
    const c = { aurora: 0, he_airglow: 0, shuttle_glow: 0, failed: 0, fwhm: [] as number[] };
    for (const x of exps) {
      if (x.qa?.aurora === true) c.aurora++;
      if (x.qa?.he_airglow === true) c.he_airglow++;
      if (x.qa?.shuttle_glow === true) c.shuttle_glow++;
      if (x.qa?.l2_dqa && x.qa.l2_dqa !== "Pass") c.failed++;
      if (typeof x.qa?.psf_fwhm_arcsec === "number") c.fwhm.push(x.qa.psf_fwhm_arcsec);
    }
    c.fwhm.sort((a, b) => a - b);
    return c;
  }, [exps]);

  if (!fb)
    return (
      <div className="space-y-3 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-4 rounded" style={{ width: `${90 - i * 12}%` }} />
        ))}
      </div>
    );

  const t = fb.target;
  const pm = Math.hypot(t.pmra, t.pmdec) / 1000;
  const contamBands =
    band === "all" ? (["D1", "D2", "D3", "D4", "D5", "D6"] as BandKey[]) : ([band] as BandKey[]);
  const contam: Record<string, number> = {};
  let masked = 0;
  let nb = 0;
  for (const b of contamBands) {
    const c = epoch?.bands[b]?.contamination;
    if (!c) continue;
    nb++;
    for (const [k, v] of Object.entries(c)) {
      if (k === "masked_pixel_fraction") masked += v;
      else contam[k] = Math.max(contam[k] ?? 0, v);
    }
  }
  masked = nb ? masked / nb : 0;

  return (
    <div>
      <Section title="Target">
        <div className="text-[15px] font-medium leading-tight">{t.name}</div>
        {t.kind && <div className="mt-0.5 text-[12px] text-fg-muted">{t.kind}</div>}
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-fg-faint">RA</dt>
          <dd className="num text-right">{fmtRA(fb.ra)}</dd>
          <dt className="text-fg-faint">Dec</dt>
          <dd className="num text-right">{fmtDec(fb.dec)}</dd>
          {pm > 0.05 && (
            <>
              <dt className="text-fg-faint">Proper motion</dt>
              <dd className="num text-right">{pm.toFixed(2)}″/yr</dd>
            </>
          )}
          <dt className="text-fg-faint">Field</dt>
          <dd className="num text-right">
            {(fb.fov_deg * 60).toFixed(1)}′ · {fb.width}×{fb.height} px
          </dd>
        </dl>
        {pm > 0.5 && (
          <p className="mt-2.5 text-[11px] leading-4 text-fg-faint">
            Centred on its predicted 2026.0 position. The crosshair follows the catalogue proper motion for each epoch.
          </p>
        )}
      </Section>

      {epoch && (
        <Section title="This epoch">
          <div className="num text-[13px]">
            {epoch.date_start} → {epoch.date_end}
          </div>
          <div className="mt-2 grid grid-cols-6 gap-1">
            {["D1", "D2", "D3", "D4", "D5", "D6"].map((d) => (
              <div
                key={d}
                className={cn(
                  "rounded-md border px-1 py-1 text-center",
                  band === d || band === "all" ? "border-border-strong" : "border-transparent opacity-50",
                )}
              >
                <div className="text-[10px] text-fg-faint">{d}</div>
                <div className="num text-[12px]">{epoch.detectors[d] ?? 0}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-fg-faint">
            exposures per detector · {epoch.collections.map((c) => c.replace("spherex_", "").toUpperCase()).join(" + ")}
          </div>
          {qa.fwhm.length > 0 && (
            <div className="num mt-2 text-[12px] text-fg-muted">
              PSF FWHM {qa.fwhm[Math.floor(qa.fwhm.length / 2)].toFixed(1)}″ (median)
            </div>
          )}
        </Section>
      )}

      {epoch && (
        <Section title="Contamination">
          <ul className="space-y-1.5 text-[12px]">
            {Object.entries(contam).length === 0 && qa.aurora + qa.he_airglow + qa.shuttle_glow + qa.failed === 0 ? (
              <li className="flex items-center gap-2 text-fg-muted">
                <CheckCircle2 className="size-3.5 text-accent" /> No artifacts flagged at the target
              </li>
            ) : null}
            {Object.entries(contam)
              .sort((a, b) => b[1] - a[1])
              .map(([k, v]) => (
                <li key={k} className="flex items-start gap-2" title={FLAG_HELP[k]}>
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-late" />
                  <span className="flex-1">
                    <span className="num">{k}</span>
                    <span className="block text-[11px] text-fg-faint">{FLAG_HELP[k] ?? "Pipeline flag"}</span>
                  </span>
                  <span className="num text-fg-muted">{Math.round(v * 100)}%</span>
                </li>
              ))}
            {qa.aurora > 0 && <QaRow label="Aurora" n={qa.aurora} of={exps.length} />}
            {qa.he_airglow > 0 && <QaRow label="He airglow (D1/D2)" n={qa.he_airglow} of={exps.length} />}
            {qa.shuttle_glow > 0 && <QaRow label="Shuttle glow" n={qa.shuttle_glow} of={exps.length} />}
            {qa.failed > 0 && <QaRow label="Failed L2 QA" n={qa.failed} of={exps.length} />}
          </ul>
          <div className="num mt-2.5 text-[11px] text-fg-faint">
            {(masked * 100).toFixed(0)}% of pixels within 30″ masked (saturation, hot/cold, outliers)
          </div>
          <p className="mt-1 text-[11px] leading-4 text-fg-faint">% = share of exposures with that flag within 30″ of the centre.</p>
        </Section>
      )}

      <Section title="Sky context">
        <SkyContext ra={fb.ra} dec={fb.dec} fovDeg={fb.fov_deg} />
      </Section>

      <Section title="Data">
        <div className="flex items-start gap-2 text-[12px] text-fg-muted">
          <Database className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <div className="text-fg">{fb.release}</div>
            <div className="num text-[11px] text-fg-faint">
              {fb.n_exposures} exposures · {fb.epochs.length} epochs · pipeline {fb.versions.join(", ")}
            </div>
            <div className="mt-1 text-[11px] text-fg-faint">
              Level 2 spectral images from NASA/IPAC IRSA.{" "}
              {source === "static" && <span className="text-late">Offline snapshot (API unreachable).</span>}
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}

function QaRow({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <li className="flex items-center gap-2">
      <AlertTriangle className="size-3.5 shrink-0 text-late" />
      <span className="flex-1">{label}</span>
      <span className="num text-fg-muted">
        {n}/{of}
      </span>
    </li>
  );
}
