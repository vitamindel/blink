import type { Flipbook, Job, Target } from "./types";

export const API_BASE = process.env.NEXT_PUBLIC_BLINK_API ?? "http://localhost:8787";

export const TEST_TARGETS: Pick<Target, "slug" | "name" | "kind" | "blurb">[] = [
  { slug: "wise-0855", name: "WISE 0855−0714", kind: "Y4 brown dwarf", blurb: "Coldest known brown dwarf, 8.2″/yr" },
  { slug: "barnards-star", name: "Barnard's Star", kind: "M4 red dwarf", blurb: "Fastest-moving star, 10.4″/yr" },
  { slug: "eps-indi-b", name: "Epsilon Indi B", kind: "T dwarf binary", blurb: "Nearby brown dwarf pair, 4.7″/yr" },
  { slug: "rw-aurigae", name: "RW Aurigae", kind: "T Tauri star", blurb: "Young star dimming erratically" },
  { slug: "r-draconis", name: "R Draconis", kind: "Mira variable", blurb: "Pulsating giant, ~245 d period" },
];

const STATIC_SLUGS = new Set(TEST_TARGETS.map((t) => t.slug));
export const FOV_OPTIONS = [3, 6, 12] as const;

async function getJSON<T>(url: string, signal?: AbortSignal): Promise<{ status: number; body: T }> {
  const r = await fetch(url, { signal });
  const body = (await r.json()) as T;
  return { status: r.status, body };
}

export interface FlipbookRequest {
  target?: string;
  ra?: number;
  dec?: number;
  fov: number;
}

/**
 * Load a flipbook. Order: backend API (may return 202 + job to poll while IRSA downloads),
 * then the static snapshot bundled with the web app (test targets only) if the backend is down.
 */
export async function loadFlipbook(
  req: FlipbookRequest,
  onProgress?: (job: Job) => void,
  signal?: AbortSignal,
): Promise<{ flipbook: Flipbook; source: "api" | "static" }> {
  const q = new URLSearchParams({ fov: String(req.fov) });
  if (req.target) q.set("target", req.target);
  if (req.ra !== undefined && req.dec !== undefined) {
    q.set("ra", String(req.ra));
    q.set("dec", String(req.dec));
  }
  try {
    for (;;) {
      const { status, body } = await getJSON<Flipbook | Job>(`${API_BASE}/api/flipbook?${q}`, signal);
      if (status === 200) return { flipbook: body as Flipbook, source: "api" };
      if (status === 202) {
        const job = body as Job;
        onProgress?.(job);
        if (job.status === "error") throw new Error(job.error ?? "Processing failed");
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      throw new Error((body as unknown as { detail?: string }).detail ?? `HTTP ${status}`);
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    if (req.target && STATIC_SLUGS.has(req.target)) {
      const fov = FOV_OPTIONS.includes(req.fov as 3 | 6 | 12) ? req.fov : 6;
      const r = await fetch(`/data/${req.target}/flipbook_${fov}.json`, { signal });
      if (r.ok) return { flipbook: (await r.json()) as Flipbook, source: "static" };
    }
    throw e;
  }
}

export async function resolveQuery(q: string): Promise<Target> {
  const slug = TEST_TARGETS.find((t) => t.slug === q || t.name.toLowerCase() === q.toLowerCase())?.slug;
  const r = await fetch(`${API_BASE}/api/resolve?q=${encodeURIComponent(slug ?? q)}`);
  if (!r.ok) throw new Error((await r.json()).detail ?? "Could not resolve");
  return r.json();
}

import type { Analysis, Photometry } from "./types";

function qs(req: { target?: string; ra?: number; dec?: number }) {
  const q = new URLSearchParams();
  if (req.target) q.set("target", req.target);
  if (req.ra !== undefined && req.dec !== undefined) {
    q.set("ra", String(req.ra));
    q.set("dec", String(req.dec));
  }
  return q;
}

/** Motion analysis (sources, proper motions, Gaia comparison); polls while it is computed. */
export async function loadAnalysis(
  req: { target?: string; ra?: number; dec?: number },
  signal?: AbortSignal,
  onProgress?: (j: Job) => void,
): Promise<Analysis> {
  try {
    for (;;) {
      const r = await fetch(`${API_BASE}/api/analysis?${qs(req)}`, { signal });
      if (r.status === 200) return r.json();
      if (r.status === 202) {
        const j = (await r.json()) as Job;
        onProgress?.(j);
        if (j.status === "error") throw new Error(j.error);
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      throw new Error(`HTTP ${r.status}`);
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    if (req.target && STATIC_SLUGS.has(req.target)) {
      const r = await fetch(`/data/${req.target}/analysis.json`, { signal });
      if (r.ok) return r.json();
    }
    throw e;
  }
}

export async function loadPhotometry(
  req: { target?: string; ra?: number; dec?: number },
  src: { ra: number; dec: number; pmra?: number; pmdec?: number; t_ref?: number },
  signal?: AbortSignal,
): Promise<Photometry> {
  const q = qs(req);
  q.set("sra", src.ra.toFixed(6));
  q.set("sdec", src.dec.toFixed(6));
  q.set("pmra", (src.pmra ?? 0).toFixed(1));
  q.set("pmdec", (src.pmdec ?? 0).toFixed(1));
  q.set("t_ref", (src.t_ref ?? 2026).toFixed(3));
  const r = await fetch(`${API_BASE}/api/photometry?${q}`, { signal });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`);
  return r.json();
}

import type { Candidates } from "./types";

export async function loadCandidates(req: { target?: string; ra?: number; dec?: number }, signal?: AbortSignal): Promise<Candidates> {
  try {
    for (let i = 0; i < 200; i++) {
      const r = await fetch(`${API_BASE}/api/candidates?${qs(req)}`, { signal });
      if (r.status === 200) return r.json();
      if (r.status === 202) {
        await new Promise((res) => setTimeout(res, 2500));
        continue;
      }
      throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`);
    }
    throw new Error("timed out");
  } catch (e) {
    if (signal?.aborted) throw e;
    if (req.target && STATIC_SLUGS.has(req.target)) {
      const r = await fetch(`/data/${req.target}/candidates.json`, { signal });
      if (r.ok) return r.json();
    }
    throw e;
  }
}

import type { Asteroids } from "./types";

export async function loadAsteroids(req: { target?: string; ra?: number; dec?: number }, signal?: AbortSignal): Promise<Asteroids | null> {
  try {
    const r = await fetch(`${API_BASE}/api/asteroids?${qs(req)}`, { signal });
    if (r.ok) return r.json();
  } catch {
    if (signal?.aborted) return null;
  }
  if (req.target && STATIC_SLUGS.has(req.target)) {
    const r = await fetch(`/data/${req.target}/asteroids.json`, { signal }).catch(() => null);
    if (r?.ok) return r.json();
  }
  return null;
}

export interface GaiaField {
  epoch: number;
  sources: { source_id: string; ra: number; dec: number; pmra: number | null; pmdec: number | null; g: number | null }[];
}

export async function loadGaia(req: { target?: string; ra?: number; dec?: number }, signal?: AbortSignal): Promise<GaiaField | null> {
  try {
    const r = await fetch(`${API_BASE}/api/gaia?${qs(req)}`, { signal });
    if (r.ok) return r.json();
  } catch {
    if (signal?.aborted) return null;
  }
  if (req.target && STATIC_SLUGS.has(req.target)) {
    const r = await fetch(`/data/${req.target}/gaia.json`, { signal }).catch(() => null);
    if (r?.ok) return r.json();
  }
  return null;
}
