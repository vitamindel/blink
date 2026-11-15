"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { pix2world, type TanWCS, world2pix } from "@/lib/image";
import { cn, fmtDec, fmtRA } from "@/lib/utils";

export interface Marker {
  ra: number;
  dec: number;
  label?: string;
  kind: "target" | "catalog" | "candidate" | "source" | "dot";
  color?: string;
}

export interface Arrow {
  x0: number; // pixel coords (0-based FITS)
  y0: number;
  x1: number;
  y1: number;
  color?: string;
  label?: string;
  id?: string;
}

/** The sky canvas: renders an RGBA frame at native resolution, upscaled by CSS, with SVG overlays. */
export function SkyView({
  rgba,
  n,
  wcs,
  pixelScale,
  smooth,
  markers = [],
  arrows = [],
  stamp,
  valueAt,
  unit,
  onPixelClick,
  className,
  loading,
  zoom,
}: {
  rgba: Uint8ClampedArray | null;
  n: number;
  wcs: TanWCS | null;
  pixelScale: number;
  smooth: boolean;
  markers?: Marker[];
  arrows?: Arrow[];
  stamp?: React.ReactNode;
  valueAt?: (x: number, y: number) => number | null;
  unit?: string;
  onPixelClick?: (x: number, y: number) => void;
  className?: string;
  loading?: boolean;
  zoom?: { x: number; y: number; f: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const s = Math.floor(Math.min(e.contentRect.width, e.contentRect.height));
      setSize(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !rgba || !n) return;
    if (c.width !== n) {
      c.width = n;
      c.height = n;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), n, n), 0, 0);
  }, [rgba, n]);

  const scale = size / Math.max(n, 1); // screen px per sky px
  // zoom (centred on a candidate, clamped so the view never leaves the image)
  const zf = zoom?.f ?? 1;
  const ztx = zoom ? Math.min(0, Math.max(size - size * zf, size / 2 - (zoom.x + 0.5) * scale * zf)) : 0;
  const zty = zoom ? Math.min(0, Math.max(size - size * zf, size / 2 - (n - 0.5 - zoom.y) * scale * zf)) : 0;
  // overlay coords: FITS (x, y) with row 0 at bottom -> screen (overlays are drawn unscaled so text stays crisp)
  const toScreen = (x: number, y: number) => [ztx + (x + 0.5) * scale * zf, zty + (n - 0.5 - y) * scale * zf] as const;

  const hoverInfo = useMemo(() => {
    if (!hover || !wcs) return null;
    const [ra, dec] = pix2world(wcs, hover.x, hover.y);
    const v = valueAt?.(Math.round(hover.x), Math.round(hover.y)) ?? null;
    return { ra, dec, v };
  }, [hover, wcs, valueAt]);

  // scale bar: 1 arcmin (or 30" if the field is tiny)
  const barArcsec = n * pixelScale > 300 ? 60 : 30;
  const barPx = (barArcsec / pixelScale) * scale;

  return (
    <div ref={wrapRef} className={cn("relative flex h-full w-full items-center justify-center", className)}>
      <div
        className="relative"
        style={{ width: size, height: size }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="absolute inset-0 overflow-hidden rounded-[3px]">
        <div
          className="absolute inset-0"
          style={{
            transformOrigin: "0 0",
            transform: zoom ? `translate(${ztx}px, ${zty}px) scale(${zf})` : "none",
          }}
          onMouseMove={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const k = r.width / n;
            setHover({ x: (e.clientX - r.left) / k - 0.5, y: n - 0.5 - (e.clientY - r.top) / k });
          }}
          onClick={(e) => {
            if (!onPixelClick) return;
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const k = r.width / n;
            onPixelClick((e.clientX - r.left) / k - 0.5, n - 0.5 - (e.clientY - r.top) / k);
          }}
        >
        <canvas
          ref={canvasRef}
          className={cn("absolute inset-0 h-full w-full rounded-[3px]", !smooth && "pixelated", loading && "opacity-40")}
          style={{ transition: "opacity .3s" }}
        />
        {loading && <div className="skeleton absolute inset-0 rounded-[3px] opacity-60" />}
        </div>
        {wcs && size > 0 && (
          <svg className="pointer-events-none absolute inset-0 overflow-visible" width={size} height={size}>
            <defs>
              <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
              </marker>
            </defs>
            {markers.map((m, i) => {
              const [px, py] = world2pix(wcs, m.ra, m.dec);
              const [sx, sy] = toScreen(px, py);
              if (sx < -20 || sy < -20 || sx > size + 20 || sy > size + 20) return null;
              const col = m.color ?? (m.kind === "target" ? "var(--accent)" : "rgba(255,255,255,.75)");
              const r = Math.max(10, 2.2 * scale * zf);
              return (
                <g key={i}>
                  {m.kind === "dot" ? (
                    <circle cx={sx} cy={sy} r={Math.max(2.5, 0.9 * scale)} fill="none" stroke={col} strokeWidth={1} />
                  ) : m.kind === "target" ? (
                    <g stroke={col} strokeWidth={1.5} opacity={0.9}>
                      <line x1={sx - r - 8} y1={sy} x2={sx - r + 2} y2={sy} />
                      <line x1={sx + r - 2} y1={sy} x2={sx + r + 8} y2={sy} />
                      <line x1={sx} y1={sy - r - 8} x2={sx} y2={sy - r + 2} />
                      <line x1={sx} y1={sy + r - 2} x2={sx} y2={sy + r + 8} />
                    </g>
                  ) : (
                    <circle cx={sx} cy={sy} r={r} fill="none" stroke={col} strokeWidth={1.25} strokeDasharray={m.kind === "catalog" ? "3 3" : undefined} />
                  )}
                  {m.label && (
                    <text x={sx + r + 6} y={sy - r - 2} fill={col} fontSize={11} fontFamily="var(--font-mono)" style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.7)", strokeWidth: 3 }}>
                      {m.label}
                    </text>
                  )}
                </g>
              );
            })}
            {arrows.map((a, i) => {
              const [x0, y0] = toScreen(a.x0, a.y0);
              const [x1, y1] = toScreen(a.x1, a.y1);
              return (
                <g key={a.id ?? i}>
                  <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={a.color ?? "var(--accent)"} strokeWidth={2} markerEnd="url(#arrowhead)" style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,.8))" }} />
                  {a.label && (
                    <text x={x1 + 6} y={y1 - 6} fill={a.color ?? "var(--accent)"} fontSize={11} fontFamily="var(--font-mono)" style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,.75)", strokeWidth: 3 }}>
                      {a.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        </div>
        {/* legend for masked pixels */}
        {size > 0 && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[10px] text-white/70 backdrop-blur">
            <span className="size-2.5 rounded-[2px]" style={{ background: "rgb(46,28,58)", outline: "1px solid rgba(255,255,255,.25)" }} />
            masked
          </div>
        )}
        {/* compass + scale bar */}
        {size > 0 && (
          <div className="pointer-events-none absolute bottom-3 right-3 flex items-end gap-4 text-white/80">
            <div className="flex flex-col items-center gap-1">
              <div className="h-px bg-white/80" style={{ width: barPx }} />
              <span className="num text-[10px]">{barArcsec === 60 ? "1′" : "30″"}</span>
            </div>
            <svg width="34" height="34" viewBox="0 0 34 34" className="opacity-80">
              <g stroke="white" strokeWidth="1.25" fill="none">
                <line x1="28" y1="28" x2="28" y2="8" />
                <line x1="28" y1="28" x2="8" y2="28" />
              </g>
              <text x="28" y="6" fill="white" fontSize="9" textAnchor="middle" fontFamily="var(--font-mono)">N</text>
              <text x="4" y="31" fill="white" fontSize="9" textAnchor="middle" fontFamily="var(--font-mono)">E</text>
            </svg>
          </div>
        )}
        {stamp && <div className="pointer-events-none absolute left-3 top-3">{stamp}</div>}
        {hoverInfo && (
          <div className="num pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[11px] leading-4 text-white/90 backdrop-blur">
            <div>
              {fmtRA(hoverInfo.ra)} {fmtDec(hoverInfo.dec)}
            </div>
            <div className="text-white/60">
              {hoverInfo.v === null || !Number.isFinite(hoverInfo.v) ? "masked" : `${hoverInfo.v.toPrecision(3)} ${unit ?? ""}`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
