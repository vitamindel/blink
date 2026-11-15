"use client";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import type { Colormap, StretchMode } from "@/lib/image";
import type { BandKey, Flipbook } from "@/lib/types";
import { cn } from "@/lib/utils";

const BAND_RANGE: Record<BandKey, string> = {
  all: "0.75–5.0",
  D1: "0.75–1.11",
  D2: "1.10–1.64",
  D3: "1.63–2.42",
  D4: "2.40–3.82",
  D5: "3.81–4.42",
  D6: "4.41–5.00",
};
// approximate perceptual hue for each detector's wavelength (blue → red) for the band chips
const BAND_HUE: Record<BandKey, string> = {
  all: "var(--accent)",
  D1: "#60a5fa",
  D2: "#22d3ee",
  D3: "#34d399",
  D4: "#facc15",
  D5: "#fb923c",
  D6: "#f87171",
};

export function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-faint">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function DisplayPanel(p: {
  band: BandKey;
  onBand: (b: BandKey) => void;
  bands: BandKey[];
  fb: Flipbook | null;
  fov: number;
  onFov: (f: number) => void;
  fovOptions: number[];
  mode: StretchMode;
  onMode: (m: StretchMode) => void;
  contrast: number;
  onContrast: (c: number) => void;
  brightness: number;
  onBrightness: (b: number) => void;
  cmap: Colormap;
  onCmap: (c: Colormap) => void;
  smooth: boolean;
  onSmooth: (s: boolean) => void;
  showPartial: boolean;
  onShowPartial: (s: boolean) => void;
}) {
  const counts = (b: BandKey) =>
    p.fb ? p.fb.epochs.reduce((s, e) => s + (b === "all" ? e.n_exposures : (e.detectors[b] ?? 0)), 0) : 0;
  return (
    <div>
      <Section title="Wavelength" aside={<span className="num text-[11px] text-fg-faint">{BAND_RANGE[p.band]} µm</span>}>
        <div className="grid grid-cols-4 gap-1">
          {p.bands.map((b, i) => {
            const c = counts(b);
            const active = p.band === b;
            return (
              <button
                key={b}
                onClick={() => p.onBand(b)}
                disabled={!!p.fb && c === 0}
                title={`${b === "all" ? "All detectors (S/N stack)" : `Detector ${b[1]}`} · ${BAND_RANGE[b]} µm · key ${i}`}
                className={cn(
                  "group relative flex h-11 flex-col items-start justify-center rounded-lg border px-2 text-left transition-colors disabled:opacity-30",
                  b === "all" && "col-span-1",
                  active ? "border-border-strong bg-fg/[0.07]" : "border-transparent hover:bg-fg/[0.04]",
                )}
              >
                <span className="flex items-center gap-1.5 text-[12px] font-medium">
                  <span className="size-1.5 rounded-full" style={{ background: BAND_HUE[b] }} />
                  {b === "all" ? "All" : b}
                </span>
                <span className="num text-[10px] text-fg-faint">{p.fb ? `${c} exp` : BAND_RANGE[b]}</span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="Field of view">
        <Segmented
          className="w-full"
          value={String(p.fov)}
          onChange={(v) => p.onFov(Number(v))}
          options={p.fovOptions.map((f) => ({ value: String(f), label: <span className="num">{f}′</span> }))}
        />
      </Section>

      <Section title="Stretch">
        <Segmented
          className="w-full"
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: "asinh", label: "asinh" },
            { value: "log", label: "log" },
            { value: "linear", label: "linear" },
          ]}
        />
        <Row label="Contrast" value={`${p.contrast.toFixed(2)}×`}>
          <Slider min={0.2} max={5} step={0.01} value={[p.contrast]} onValueChange={([v]) => p.onContrast(v)} />
        </Row>
        <Row label="Black point" value={`${p.brightness >= 0 ? "+" : ""}${(p.brightness * 100).toFixed(0)}%`}>
          <Slider min={-0.3} max={0.3} step={0.005} value={[p.brightness]} onValueChange={([v]) => p.onBrightness(v)} />
        </Row>
        <div className="mt-3 flex items-center gap-2">
          <Segmented
            size="sm"
            className="flex-1"
            value={p.cmap}
            onChange={p.onCmap}
            options={[
              { value: "grey", label: "Grey" },
              { value: "ir", label: "Infrared" },
              { value: "ice", label: "Ice" },
            ]}
          />
          <Segmented
            size="sm"
            value={p.smooth ? "smooth" : "px"}
            onChange={(v) => p.onSmooth(v === "smooth")}
            options={[
              { value: "px", label: "Pixels", title: "Show native 6.2″ pixels" },
              { value: "smooth", label: "Smooth" },
            ]}
          />
        </div>
      </Section>

      <Section title="Epochs">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-[12px] text-fg-muted">
          <span>
            Include short visits
            <span className="block text-[11px] text-fg-faint">Revisits with only a few exposures are noisier.</span>
          </span>
          <input type="checkbox" checked={p.showPartial} onChange={(e) => p.onShowPartial(e.target.checked)} className="size-4" />
        </label>
      </Section>

      <div className="hidden px-4 py-3 text-[11px] leading-5 text-fg-faint md:block">
        <span className="text-fg-muted">Shortcuts</span> · Space play · ←/→ step · B blink · 0–6 band · ⌘K search
      </div>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[12px]">
        <span className="text-fg-muted">{label}</span>
        <span className="num text-fg-faint">{value}</span>
      </div>
      {children}
    </div>
  );
}
