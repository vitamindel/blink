"use client";
import { useEffect, useState } from "react";
import { TEST_TARGETS } from "@/lib/api";
import type { Analysis } from "@/lib/types";

interface Metrics {
  model: { name: string; params: number; input: string };
  data: { train_samples: number; train_positive_frac: number; test_samples: number; train_fields: string[]; test_fields: string[] };
  roc_auc: number;
  average_precision: number;
  threshold: number;
  precision: number;
  recall: number;
  tp: number;
  fp: number;
  fn: number;
  roc: [number, number][];
  pr: [number, number][];
  fp_rate_by_negative_type: Record<string, number>;
  recall_by_spectrum: Record<string, number>;
  completeness: { snr_bins: number[]; disp_bins_px?: number[]; speed_bins_arcsec_yr?: number[]; grid: { n: number; recovered: number | null }[][]; note?: string };
  real_objects: { field: string; name: string; kind: string; pm_mas_yr: number; moving: boolean; score: number; g?: number }[];
  history: { epoch: number; train_loss: number; val_loss: number; val_acc: number }[];
}

const NEG_LABEL: Record<string, string> = {
  static_source: "Real static sources",
  sky: "Empty sky",
  diff_peak: "Real difference-image peaks (artifacts)",
  static_variable: "Synthetic static variables",
  saturated_edge: "Edges of saturated stars",
  offcenter_mover: "Movers 4–9 px off-centre",
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-14 text-[22px] font-semibold tracking-tight">
      {children}
    </h2>
  );
}

export function MethodsLive() {
  const [rows, setRows] = useState<{ name: string; a: Analysis }[]>([]);
  const [m, setM] = useState<Metrics | null>(null);
  const [mErr, setMErr] = useState(false);
  useEffect(() => {
    Promise.all(
      TEST_TARGETS.map((t) =>
        fetch(`/data/${t.slug}/analysis.json`)
          .then((r) => (r.ok ? r.json() : null))
          .then((a) => (a ? { name: t.name, a: a as Analysis } : null))
          .catch(() => null),
      ),
    ).then((x) => setRows(x.filter(Boolean) as { name: string; a: Analysis }[]));
    fetch("/data/ml_metrics.json")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setM)
      .catch(() => setMErr(true));
  }, []);

  return (
    <>
      <H2 id="validation">Validation against Gaia DR3</H2>
      <p className="mt-3 text-[15px] leading-7 text-fg-muted">
        Every field is cross-matched with Gaia DR3 (propagated to each epoch). Movers Blink measures at ≥5σ are compared
        with Gaia, and field stars give the overall scatter. A ≥5σ “mover” that Gaia sees as near-static is vetoed and
        listed as such in the viewer.
      </p>
      <div className="mt-5 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="bg-fg/[0.03] text-[11px] uppercase tracking-[0.06em] text-fg-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Movers (≥5σ)</th>
              <th className="px-3 py-2 font-medium">Blink μ</th>
              <th className="px-3 py-2 font-medium">Gaia μ</th>
              <th className="px-3 py-2 font-medium">Gaia-matched stars</th>
              <th className="px-3 py-2 font-medium">Scatter vs Gaia</th>
              <th className="px-3 py-2 font-medium">Vetoed</th>
            </tr>
          </thead>
          <tbody className="num">
            {rows.map(({ name, a }) => {
              const movers = a.movers.map((id) => a.sources.find((s) => s.id === id)!).filter(Boolean);
              const top = movers[0];
              return (
                <tr key={name} className="border-t border-border">
                  <td className="px-3 py-2 font-sans text-fg">{name}</td>
                  <td className="px-3 py-2">{movers.length}</td>
                  <td className="px-3 py-2">{top ? `${((top.pm ?? 0) / 1000).toFixed(2)} ± ${((top.epm ?? 0) / 1000).toFixed(2)}″/yr` : "—"}</td>
                  <td className="px-3 py-2">{top?.gaia?.pm != null ? `${(top.gaia.pm / 1000).toFixed(2)}″/yr` : "—"}</td>
                  <td className="px-3 py-2">{a.gaia_comparison.n}</td>
                  <td className="px-3 py-2">{((a.gaia_comparison.robust_scatter_mas_yr ?? 0) / 1000).toFixed(2)}″/yr</td>
                  <td className="px-3 py-2">{a.rejected_by_gaia?.length ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-fg-faint">
        WISE 0855 has no Gaia counterpart (too red) and is blended with a background star in 2025–26; RW Aur and R Dra are
        not expected to move at SPHEREx precision.
      </p>

      <H2 id="model">Model card: mover CNN</H2>
      {!m ? (
        <p className="mt-3 text-[15px] text-fg-muted">{mErr ? "Metrics will appear here once the model is trained." : "Loading…"}</p>
      ) : (
        <ModelCard m={m} />
      )}
    </>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="text-[11px] uppercase tracking-[0.06em] text-fg-faint">{label}</div>
      <div className="num mt-1 text-[26px] font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[12px] text-fg-faint">{sub}</div>}
    </div>
  );
}

function Curve({ pts, xl, yl, diag }: { pts: [number, number][]; xl: string; yl: string; diag?: boolean }) {
  const W = 300;
  const H = 220;
  const p = 34;
  const sx = (v: number) => p + v * (W - p - 8);
  const sy = (v: number) => H - p + 6 - v * (H - p - 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={sx(0)} x2={sx(1)} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
          <text x={p - 6} y={sy(t) + 3} fontSize={10} textAnchor="end" fill="var(--fg-faint)" fontFamily="var(--font-mono)">
            {t}
          </text>
          <text x={sx(t)} y={H - p + 20} fontSize={10} textAnchor="middle" fill="var(--fg-faint)" fontFamily="var(--font-mono)">
            {t}
          </text>
        </g>
      ))}
      {diag && <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--fg-faint)" strokeDasharray="3 3" />}
      <polyline fill="none" stroke="var(--accent)" strokeWidth={2} points={pts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")} />
      <text x={W - 8} y={H - 4} fontSize={10.5} textAnchor="end" fill="var(--fg-muted)">
        {xl}
      </text>
      <text x={4} y={12} fontSize={10.5} fill="var(--fg-muted)">
        {yl}
      </text>
    </svg>
  );
}

function ModelCard({ m }: { m: Metrics }) {
  const c = m.completeness;
  const bins = c.disp_bins_px ?? c.speed_bins_arcsec_yr ?? [];
  const binUnit = c.disp_bins_px ? "px" : "″/yr";
  // only show displacement bins that actually received injections
  const cols = bins.slice(0, -1).map((_, j) => j).filter((j) => c.grid.some((row) => row[j]?.n > 0));
  return (
    <div>
      <p className="mt-3 text-[15px] leading-7 text-fg-muted">
        A small real/bogus convolutional network in the style of ZTF’s braai. It looks at a {m.model.input} stamp — two
        epochs and their difference, for all detectors and for the red D4–D6 detectors — and outputs the probability that
        something at the centre moved. {m.model.params.toLocaleString()} parameters; runs in the browser (onnxruntime-web)
        with a server fallback.
      </p>
      <h3 className="mt-8 text-[15px] font-semibold">Training data (synthetic, by injection)</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-6 text-fg-muted">
        <li>
          <b className="text-fg">Positives:</b> point sources injected into real per-epoch, per-detector coadds using each
          coadd’s own ePSF, at positions on a straight line between two epochs ≥ 0.35 yr apart. S/N 3–400 (log-uniform),
          speed 0.3–15″/yr (log-uniform; only cases moving ≥ 0.35 px are labelled movers), random direction, flat / red
          (brown-dwarf-like) / blue spectral shapes, ±15% flux jitter.
        </li>
        <li>
          <b className="text-fg">Negatives:</b> real static sources, empty sky, real difference-image peaks (artifacts,
          saturated-star residuals, edges), synthetic static variables (flux changes ×1.5–8, position does not) and
          synthetic movers placed 4–9 px <i>off</i> the stamp centre (the label is about the centre only).
        </li>
        <li>
          <b className="text-fg">Never in training:</b> real movers (all ≥5σ movers and Gaia stars faster than 0.3″/yr are
          masked), SkyBoT asteroids, and the held-out fields {m.data.test_fields.join(", ")}.
        </li>
        <li>
          {m.data.train_samples.toLocaleString()} training stamps from {m.data.train_fields.length} fields; augmented with
          rotations and flips. Synthetic data is used only here — the viewer shows real SPHEREx data only.
        </li>
      </ul>

      <h3 className="mt-8 text-[15px] font-semibold">Held-out performance (unseen fields, threshold {m.threshold})</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ROC AUC" value={m.roc_auc.toFixed(3)} />
        <Stat label="Avg precision" value={m.average_precision.toFixed(3)} />
        <Stat label="Precision" value={m.precision.toFixed(3)} sub={`${m.fp} false positives`} />
        <Stat label="Recall" value={m.recall.toFixed(3)} sub={`${m.fn} missed`} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <figure className="rounded-xl border border-border p-3">
          <Curve pts={m.roc} xl="false-positive rate" yl="true-positive rate" diag />
          <figcaption className="mt-1 text-[12px] text-fg-faint">ROC on {m.data.test_samples.toLocaleString()} held-out stamps</figcaption>
        </figure>
        <figure className="rounded-xl border border-border p-3">
          <Curve pts={m.pr} xl="recall" yl="precision" />
          <figcaption className="mt-1 text-[12px] text-fg-faint">Precision–recall (held-out)</figcaption>
        </figure>
      </div>

      <h3 className="mt-8 text-[15px] font-semibold">Injection–recovery completeness</h3>
      <p className="mt-1 text-[13px] text-fg-faint">
        Fraction of injected movers scored ≥ {m.threshold}, by S/N per epoch and by how far the source moved between the two
        epochs{c.disp_bins_px ? " (1 px = 6.15″, about 6″/yr over a one-year baseline)" : ""}.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="num text-[12px]">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-normal text-fg-faint">S/N \ {binUnit}</th>
              {cols.map((j) => (
                <th key={j} className="px-2 py-1 font-normal text-fg-faint">
                  {bins[j]}–{bins[j + 1]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.grid.map((row, i) => (
              <tr key={i}>
                <td className="px-2 py-1 text-fg-faint">
                  {c.snr_bins[i]}–{c.snr_bins[i + 1]}
                </td>
                {cols.map((j) => row[j]).map((cell, j) => (
                  <td key={j} className="p-0.5">
                    <div
                      className="flex h-9 w-16 items-center justify-center rounded-md"
                      style={{
                        background:
                          cell.recovered === null ? "var(--border)" : `color-mix(in oklab, var(--accent) ${Math.round(cell.recovered * 100)}%, var(--bg-elev))`,
                        color: cell.recovered !== null && cell.recovered > 0.55 ? "var(--accent-fg)" : "var(--fg)",
                      }}
                      title={`${cell.n} injections`}
                    >
                      {cell.recovered === null ? "—" : `${Math.round(cell.recovered * 100)}%`}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-fg-muted">
        Recall by spectral shape:{" "}
        {Object.entries(m.recall_by_spectrum)
          .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
          .join(" · ")}
        .
      </p>

      <h3 className="mt-8 text-[15px] font-semibold">False positives by negative type</h3>
      <ul className="mt-2 space-y-1 text-[13px]">
        {Object.entries(m.fp_rate_by_negative_type).map(([k, v]) => (
          <li key={k} className="flex max-w-md justify-between border-b border-border py-1">
            <span className="text-fg-muted">{NEG_LABEL[k] ?? k}</span>
            <span className="num">{(v * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-[15px] font-semibold">Real objects (never trained on)</h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[480px] text-left text-[13px]">
          <thead className="bg-fg/[0.03] text-[11px] uppercase tracking-[0.06em] text-fg-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Object</th>
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">True μ</th>
              <th className="px-3 py-2 font-medium">CNN score</th>
            </tr>
          </thead>
          <tbody className="num">
            {m.real_objects
              .filter((r) => r.kind === "target" || r.pm_mas_yr > 300)
              .sort((a, b) => b.pm_mas_yr - a.pm_mas_yr)
              .map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 font-sans">{r.name}</td>
                  <td className="px-3 py-2">{r.field}</td>
                  <td className="px-3 py-2">{(r.pm_mas_yr / 1000).toFixed(2)}″/yr</td>
                  <td className="px-3 py-2">
                    <span className={r.score >= m.threshold ? "text-accent" : "text-fg-muted"}>{r.score.toFixed(2)}</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {(() => {
        const st = m.real_objects.filter((r) => r.kind === "gaia" && r.pm_mas_yr < 20);
        const fp = st.filter((r) => r.score >= m.threshold).length;
        return st.length ? (
          <p className="mt-2 text-[13px] text-fg-muted">
            Real Gaia stars moving &lt; 0.02″/yr: {fp} of {st.length} scored as movers ({((100 * fp) / st.length).toFixed(1)}%).
          </p>
        ) : null;
      })()}

      <h3 className="mt-8 text-[15px] font-semibold">From stamps to a candidate list</h3>
      <p className="mt-2 text-[14px] leading-6 text-fg-muted">
        In a field, every detected source and every real difference-image dipole is a candidate. Each is scored on a 3×3
        grid of ±1 px offsets (a mover’s stamp must be centred on its track midpoint, which a blended centroid can miss)
        and keeps its best score. Because that takes the best of nine, the flagging threshold is raised to{" "}
        <b className="text-fg">0.9</b>, calibrated on real stars: 0.6% of 628 static Gaia stars in the five challenge
        fields exceed it, while Barnard’s Star (1.00), ε Indi B (1.00) and WISE 0855 (0.97) all pass — WISE 0855 even
        though its centroid-based motion fails because of the blend.
      </p>

      <h3 className="mt-8 text-[15px] font-semibold">Known failure modes</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-6 text-fg-muted">
        <li>Blends: a mover within ~1 px of a static star (WISE 0855 in 2025–26) looks like a variable, not a dipole.</li>
        <li>Saturated stars: masked cores and bloom residuals can mimic motion; the model was shown such edges as negatives but they remain the main source of false positives.</li>
        <li>Asteroids move degrees per day, so in an epoch coadd they are faint single-epoch blobs, not dipoles; the model is not built for them (SkyBoT positions are overlaid instead).</li>
        <li>Very slow movers (&lt;0.5″/yr over ~1 yr) are below a tenth of a pixel and are mostly missed.</li>
        <li>Trained on synthetic injections: real-object performance is checked on only a handful of objects.</li>
      </ul>
    </div>
  );
}
