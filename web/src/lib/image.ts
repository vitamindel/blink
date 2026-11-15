/** Client-side pixel pipeline: decode float32 frames, compute robust levels, stretch to RGBA.
 *  Everything here is cheap (≈120² px) so sliders re-render instantly. */

/** Masked / no-data pixels (saturated cores, bad pixels, off-detector) — distinct from 'dark sky'. */
export const MASK_RGB: [number, number, number] = [46, 28, 58];

export type StretchMode = "asinh" | "linear" | "log";
export type Colormap = "grey" | "ir" | "ice";

const cache = new Map<string, Float32Array>();

export function decodeF32(b64: string): Float32Array {
  const hit = cache.get(b64);
  if (hit) return hit;
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const out = new Float32Array(buf);
  if (cache.size > 400) cache.clear();
  cache.set(b64, out);
  return out;
}

/** Percentiles over finite values (sampled for speed). */
export function percentiles(arrs: Float32Array[], ps: number[]): number[] {
  const vals: number[] = [];
  for (const a of arrs) {
    const step = Math.max(1, Math.floor(a.length / 6000));
    for (let i = 0; i < a.length; i += step) if (Number.isFinite(a[i])) vals.push(a[i]);
  }
  if (!vals.length) return ps.map(() => 0);
  vals.sort((x, y) => x - y);
  return ps.map((p) => vals[Math.min(vals.length - 1, Math.max(0, Math.round((p / 100) * (vals.length - 1))))]);
}

export interface Levels {
  lo: number; // black point (data units)
  hi: number; // white point (data units)
  noise: number; // ≈ background sigma (data units)
}

/** Robust levels: black just below sky, white at a high percentile. Shared across all frames so blinking is honest. */
export function autoLevels(arrs: Float32Array[]): Levels {
  const [p16, p50, p84, p995] = percentiles(arrs, [16, 50, 84, 99.7]);
  const noise = Math.max((p84 - p16) / 2, 1e-12);
  return { lo: p50 - 2 * noise, hi: Math.max(p995, p50 + 10 * noise), noise };
}

// 256-entry LUTs
function lut(stops: [number, [number, number, number]][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    for (let j = 0; j < 3; j++) out[i * 3 + j] = c0[j] + (c1[j] - c0[j]) * f;
  }
  return out;
}

export const LUTS: Record<Colormap, Uint8ClampedArray> = {
  grey: lut([
    [0, [0, 0, 0]],
    [1, [255, 255, 255]],
  ]),
  ir: lut([
    [0, [0, 0, 4]],
    [0.25, [60, 15, 110]],
    [0.5, [190, 55, 80]],
    [0.75, [250, 150, 40]],
    [1, [252, 252, 200]],
  ]),
  ice: lut([
    [0, [0, 0, 0]],
    [0.4, [20, 60, 120]],
    [0.75, [110, 190, 230]],
    [1, [240, 252, 255]],
  ]),
};

export interface StretchOpts {
  mode: StretchMode;
  levels: Levels;
  contrast: number; // 0.2..5, multiplies asinh softening
  brightness: number; // -0.5..0.5 shifts black point (fraction of range)
  cmap: Colormap;
  nanColor?: [number, number, number];
}

export function stretchValue(v: number, o: StretchOpts): number {
  const { lo, hi, noise } = o.levels;
  const range = hi - lo;
  const lo2 = lo - o.brightness * range;
  let x = (v - lo2) / (hi - lo2);
  if (o.mode === "asinh") {
    const soft = Math.max(noise * 3, 1e-12) / (hi - lo2) / o.contrast;
    x = Math.asinh(x / soft) / Math.asinh(1 / soft);
  } else if (o.mode === "log") {
    const a = 1000 * o.contrast;
    x = Math.log10(1 + a * Math.max(0, x)) / Math.log10(1 + a);
  } else {
    x = (x - 0.5) * o.contrast + 0.5;
  }
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Render a float frame into RGBA (flipped so north is up: FITS row 0 is the bottom). */
export function renderRGBA(src: Float32Array, n: number, o: StretchOpts, out?: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = out ?? new Uint8ClampedArray(n * n * 4);
  const L = LUTS[o.cmap];
  const nan = o.nanColor ?? MASK_RGB;
  for (let y = 0; y < n; y++) {
    const srow = (n - 1 - y) * n;
    for (let x = 0; x < n; x++) {
      const v = src[srow + x];
      const p = (y * n + x) * 4;
      if (!Number.isFinite(v)) {
        rgba[p] = nan[0];
        rgba[p + 1] = nan[1];
        rgba[p + 2] = nan[2];
      } else {
        const k = Math.round(stretchValue(v, o) * 255) * 3;
        rgba[p] = L[k];
        rgba[p + 1] = L[k + 1];
        rgba[p + 2] = L[k + 2];
      }
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

/** Two-colour composite: early epoch in one hue, late in another; static sources sum to white. */
export function renderComposite(
  a: Float32Array,
  b: Float32Array,
  n: number,
  o: StretchOpts,
  colA: [number, number, number],
  colB: [number, number, number],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    const srow = (n - 1 - y) * n;
    for (let x = 0; x < n; x++) {
      const va = a[srow + x];
      const vb = b[srow + x];
      const p = (y * n + x) * 4;
      if (!Number.isFinite(va) || !Number.isFinite(vb)) {
        // masked in either epoch: don't fake a colour change
        rgba[p] = MASK_RGB[0];
        rgba[p + 1] = MASK_RGB[1];
        rgba[p + 2] = MASK_RGB[2];
        rgba[p + 3] = 255;
        continue;
      }
      const sa = stretchValue(va, o);
      const sb = stretchValue(vb, o);
      rgba[p] = Math.min(255, sa * colA[0] + sb * colB[0]);
      rgba[p + 1] = Math.min(255, sa * colA[1] + sb * colB[1]);
      rgba[p + 2] = Math.min(255, sa * colA[2] + sb * colB[2]);
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

/** Diverging render for difference images: negative = colA, positive = colB. */
export function renderDiff(
  d: Float32Array,
  n: number,
  scale: number,
  colNeg: [number, number, number],
  colPos: [number, number, number],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    const srow = (n - 1 - y) * n;
    for (let x = 0; x < n; x++) {
      const v = d[srow + x];
      const p = (y * n + x) * 4;
      rgba[p + 3] = 255;
      if (!Number.isFinite(v)) {
        rgba[p] = rgba[p + 1] = rgba[p + 2] = 22;
        continue;
      }
      // soft threshold: |Δ| < 1.5σ stays black so noise doesn't masquerade as change
      const t0 = Math.asinh(1.5);
      const t = Math.min(1, Math.max(0, (Math.asinh(Math.abs(v) / scale) - t0) / (Math.asinh(15) - t0)));
      const c = v < 0 ? colNeg : colPos;
      rgba[p] = 10 + t * (c[0] - 10);
      rgba[p + 1] = 10 + t * (c[1] - 10);
      rgba[p + 2] = 12 + t * (c[2] - 12);
    }
  }
  return rgba;
}

/** Gnomonic (TAN) WCS, matching the backend grid (north up, east left). Pixel coords are 0-based FITS (row 0 = south). */
export interface TanWCS {
  crval: [number, number];
  crpix: [number, number];
  cdelt: [number, number];
}

const D2R = Math.PI / 180;

export function pix2world(w: TanWCS, x: number, y: number): [number, number] {
  const xi = (x + 1 - w.crpix[0]) * w.cdelt[0] * D2R;
  const eta = (y + 1 - w.crpix[1]) * w.cdelt[1] * D2R;
  const a0 = w.crval[0] * D2R;
  const d0 = w.crval[1] * D2R;
  const den = Math.cos(d0) - eta * Math.sin(d0);
  const ra = a0 + Math.atan2(xi, den);
  const dec = Math.atan2(Math.sin(d0) + eta * Math.cos(d0), Math.sqrt(xi * xi + den * den));
  return [((ra / D2R) % 360 + 360) % 360, dec / D2R];
}

export function world2pix(w: TanWCS, ra: number, dec: number): [number, number] {
  const a = ra * D2R;
  const d = dec * D2R;
  const a0 = w.crval[0] * D2R;
  const d0 = w.crval[1] * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc;
  return [xi / D2R / w.cdelt[0] + w.crpix[0] - 1, eta / D2R / w.cdelt[1] + w.crpix[1] - 1];
}

/** Remove large-scale background from an image (e.g. a difference of two epochs with different
 *  scattered light): median in `tile`×`tile` px boxes, bilinearly interpolated, subtracted. */
export function subtractBackground(a: Float32Array, n: number, tile = 12): Float32Array {
  const nt = Math.max(2, Math.round(n / tile));
  const step = n / nt;
  const grid = new Float32Array(nt * nt);
  const buf: number[] = [];
  for (let ty = 0; ty < nt; ty++)
    for (let tx = 0; tx < nt; tx++) {
      buf.length = 0;
      for (let y = Math.floor(ty * step); y < Math.floor((ty + 1) * step); y++)
        for (let x = Math.floor(tx * step); x < Math.floor((tx + 1) * step); x++) {
          const v = a[y * n + x];
          if (Number.isFinite(v)) buf.push(v);
        }
      buf.sort((p, q) => p - q);
      grid[ty * nt + tx] = buf.length ? buf[Math.floor(buf.length / 2)] : 0;
    }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const gy = Math.min(Math.max((y + 0.5) / step - 0.5, 0), nt - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(y0 + 1, nt - 1);
    const fy = gy - y0;
    for (let x = 0; x < n; x++) {
      const gx = Math.min(Math.max((x + 0.5) / step - 0.5, 0), nt - 1);
      const x0 = Math.floor(gx);
      const x1 = Math.min(x0 + 1, nt - 1);
      const fx = gx - x0;
      const bg =
        grid[y0 * nt + x0] * (1 - fx) * (1 - fy) +
        grid[y0 * nt + x1] * fx * (1 - fy) +
        grid[y1 * nt + x0] * (1 - fx) * fy +
        grid[y1 * nt + x1] * fx * fy;
      out[y * n + x] = a[y * n + x] - bg;
    }
  }
  return out;
}
