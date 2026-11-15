"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeF32, percentiles } from "@/lib/image";
import type { Flipbook } from "@/lib/types";
import { world2pix } from "@/lib/image";

/** Live blink of real SPHEREx data for WISE 0855 (D5+D6 combined in S/N), from the bundled snapshot. */
export function HeroBlink() {
  const [fb, setFb] = useState<Flipbook | null>(null);
  const [k, setK] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch("/data/wise-0855/flipbook_3.json")
      .then((r) => r.json())
      .then(setFb)
      .catch(() => null);
  }, []);

  const frames = useMemo(() => {
    if (!fb) return [];
    const out: { date: string; year: number; img: Float32Array; n: number }[] = [];
    for (const e of fb.epochs) {
      const d5 = e.bands.D5;
      const d6 = e.bands.D6;
      if (!d5?.data || !d6?.data || d5.n + d6.n < 6) continue;
      const a = decodeF32(d5.data);
      const b = decodeF32(d6.data);
      const img = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) img[i] = (a[i] / (d5.noise ?? 1) + b[i] / (d6.noise ?? 1)) / Math.SQRT2;
      out.push({ date: e.date_mid, year: e.year_mid, img, n: d5.n + d6.n });
    }
    // longest baseline pair
    return out.length > 2 ? [out[0], out[out.length - 1]] : out;
  }, [fb]);

  useEffect(() => {
    if (frames.length < 2) return;
    const t = setInterval(() => setK((x) => (x + 1) % frames.length), 700);
    return () => clearInterval(t);
  }, [frames.length]);

  const levels = useMemo(() => {
    if (!frames.length) return null;
    const [p50, p995] = percentiles(frames.map((f) => f.img), [50, 99.6]);
    return { lo: p50 + 0.4, hi: Math.max(p995, p50 + 10) }; // dark sky, so the brown dwarf pops
  }, [frames]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !fb || !frames.length || !levels) return;
    const n = fb.width;
    c.width = n;
    c.height = n;
    const ctx = c.getContext("2d")!;
    const im = ctx.createImageData(n, n);
    const f = frames[k];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = f.img[(n - 1 - y) * n + x];
        const t = Number.isFinite(v) ? Math.min(1, Math.max(0, Math.asinh((v - levels.lo) / 2) / Math.asinh((levels.hi - levels.lo) / 2))) : 0;
        const p = (y * n + x) * 4;
        im.data[p] = 8 + t * 240;
        im.data[p + 1] = 9 + t * 244;
        im.data[p + 2] = 10 + t * 236;
        im.data[p + 3] = 255;
      }
    ctx.putImageData(im, 0, 0);
  }, [fb, frames, k, levels]);

  const mark = useMemo(() => {
    if (!fb || !frames.length) return null;
    const t = fb.target;
    const w = { crval: fb.wcs.crval, crpix: fb.wcs.crpix, cdelt: fb.wcs.cdelt };
    return frames.map((f) => {
      const dt = f.year - t.ref_epoch;
      const dec = t.dec + (t.pmdec * dt) / 3.6e6;
      const ra = t.ra + (t.pmra * dt) / 3.6e6 / Math.cos((dec * Math.PI) / 180);
      const [x, y] = world2pix(w, ra, dec);
      return { x: (x + 0.5) / fb.width, y: 1 - (y + 0.5) / fb.width };
    });
  }, [fb, frames]);

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-border-strong bg-black shadow-[0_40px_120px_-40px_var(--hero-glow,rgba(198,244,50,0.25))]">
      <canvas ref={canvas} className="pixelated absolute inset-0 h-full w-full" aria-label="SPHEREx images of WISE 0855 blinking between two epochs" />
      {!fb && <div className="skeleton absolute inset-0 opacity-30" />}
      {mark &&
        mark.map((m, i) => (
          <div
            key={i}
            className="absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-opacity duration-200"
            style={{
              left: `${m.x * 100}%`,
              top: `${m.y * 100}%`,
              borderColor: i === 0 ? "var(--early)" : "var(--late)",
              opacity: i === k ? 1 : 0.25,
            }}
          />
        ))}
      {frames[k] && (
        <div className="absolute left-3 top-3 rounded-lg bg-black/60 px-2.5 py-1.5 text-white backdrop-blur-md">
          <div className="num text-[15px] font-medium leading-5">{frames[k].date}</div>
          <div className="num text-[11px] text-white/60">SPHEREx D5+D6 · 3.8–5.0 µm · {frames[k].n} exp</div>
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between text-white">
        <div className="rounded-lg bg-black/60 px-2.5 py-1.5 backdrop-blur-md">
          <div className="text-[13px] font-medium">WISE 0855−0714</div>
          <div className="num text-[11px] text-white/60">coldest known brown dwarf · 8.2″/yr · 2.3 pc</div>
        </div>
        <div className="num rounded-md bg-black/60 px-2 py-1 text-[10px] text-white/60 backdrop-blur-md">real data · 3′ field</div>
      </div>
    </div>
  );
}
