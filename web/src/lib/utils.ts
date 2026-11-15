import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** RA (deg) → "17h57m48.50s" */
export function fmtRA(deg: number, prec = 2): string {
  let h = (((deg % 360) + 360) % 360) / 15;
  const hh = Math.floor(h);
  h = (h - hh) * 60;
  const mm = Math.floor(h);
  const ss = (h - mm) * 60;
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss.toFixed(prec).padStart(prec + 3, "0")}s`;
}

/** Dec (deg) → "+04°41′36.0″" */
export function fmtDec(deg: number, prec = 1): string {
  const s = deg < 0 ? "−" : "+";
  let d = Math.abs(deg);
  const dd = Math.floor(d);
  d = (d - dd) * 60;
  const mm = Math.floor(d);
  const ss = (d - mm) * 60;
  return `${s}${String(dd).padStart(2, "0")}°${String(mm).padStart(2, "0")}′${ss.toFixed(prec).padStart(prec + 3, "0")}″`;
}

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}
