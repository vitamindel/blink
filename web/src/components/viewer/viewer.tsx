"use client";
import { AnimatePresence, motion } from "framer-motion";
import { Command as CmdIcon, Info, Link2, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Kbd, Tip, TooltipProvider } from "@/components/ui/tooltip";
import { FOV_OPTIONS, type GaiaField, loadAnalysis, loadAsteroids, loadCandidates, loadFlipbook, loadGaia } from "@/lib/api";
import { scoreStamps } from "@/lib/mover-model";
import { autoLevels, type Colormap, decodeF32, renderComposite, renderDiff, renderRGBA, type StretchMode, subtractBackground, world2pix } from "@/lib/image";
import type { Analysis, Asteroids, BandKey, Candidate, Candidates, Flipbook, Job } from "@/lib/types";
import { CandidatesPanel, MotionFit } from "./candidates-panel";
import { SpectrumSection } from "./spectrum-section";
import { cn, fmtDec, fmtRA } from "@/lib/utils";
import { DisplayPanel } from "./display-panel";
import { InfoPanel } from "./info-panel";
import { MotionPanel, SourcePanel } from "./motion-panel";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { PlayerBar, type Speed, type TimelineFrame } from "./player-bar";
import { type Arrow, type Marker, SkyView } from "./sky-view";

const BANDS: BandKey[] = ["all", "D1", "D2", "D3", "D4", "D5", "D6"];
export type ViewMode = "flip" | "stack" | "diff" | "motion";
const EARLY: [number, number, number] = [0, 150, 255]; // azure  (A)
const LATE: [number, number, number] = [255, 105, 0]; // orange (B) — A + B = white, so static stars stay neutral

export function Viewer() {
  const sp = useSearchParams();
  const target = sp.get("target") ?? undefined;
  const raQ = sp.get("ra");
  const decQ = sp.get("dec");
  const nameQ = sp.get("name");
  const embed = sp.get("embed") === "1";
  const [fov, setFov] = useState<number>(Number(sp.get("fov")) || 6);
  const [band, setBand] = useState<BandKey>((sp.get("band") as BandKey) || "all");

  const [fb, setFb] = useState<Flipbook | null>(null);
  const [source, setSource] = useState<"api" | "static" | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>("2");
  const [loop, setLoop] = useState(true);
  const [blink, setBlink] = useState(false);
  const [blinkA, setBlinkA] = useState(0);
  const [blinkB, setBlinkB] = useState(0);
  const [showPartial, setShowPartial] = useState(false);

  const [mode, setMode] = useState<StretchMode>("asinh");
  const [contrast, setContrast] = useState(1);
  const [brightness, setBrightness] = useState(0);
  const [cmap, setCmap] = useState<Colormap>("grey");
  const [smooth, setSmooth] = useState(false);

  const [view, setView] = useState<ViewMode>((sp.get("view") as ViewMode) || "flip");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [rightTab, setRightTab] = useState<"info" | "motion" | "ml" | "source">("info");
  const [cands, setCands] = useState<Candidates | null>(null);
  const [candErr, setCandErr] = useState<string | null>(null);
  const [candLoading, setCandLoading] = useState(false);
  const [browserState, setBrowserState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [focus, setFocus] = useState<Candidate | null>(null);
  const [asteroids, setAsteroids] = useState<Asteroids | null>(null);
  const [showAsteroids, setShowAsteroids] = useState(true);
  const [gaiaField, setGaiaField] = useState<GaiaField | null>(null);
  const [showGaia, setShowGaia] = useState(false);
  const [showArrows, setShowArrows] = useState(true);
  const [exaggerate, setExaggerate] = useState(10);

  const [panel, setPanel] = useState<"display" | "info" | null>(null); // mobile sheets
  const palette = useCommandPalette();
  const [copied, setCopied] = useState(false);

  // ---- load data -----------------------------------------------------------
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setJob(null);
    loadFlipbook(
      { target, ra: raQ ? Number(raQ) : undefined, dec: decQ ? Number(decQ) : undefined, fov },
      (j) => setJob(j),
      ac.signal,
    )
      .then(({ flipbook, source }) => {
        setFb(flipbook);
        setSource(source);
        setLoading(false);
        setJob(null);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => ac.abort();
  }, [target, raQ, decQ, fov]);

  // ---- motion analysis (loads after the flipbook; independent of FOV) -------------------
  const req = useMemo(
    () => ({ target, ra: raQ ? Number(raQ) : undefined, dec: decQ ? Number(decQ) : undefined }),
    [target, raQ, decQ],
  );
  const fbReady = fb !== null;
  const fbRef = useRef(fb);
  fbRef.current = fb;
  useEffect(() => {
    if (!fbReady) return;
    const ac = new AbortController();
    setAnalysisLoading(true);
    loadAnalysis(req, ac.signal)
      .then((a) => {
        setAnalysis(a);
        // pre-select the source at the target position so its light curve is one click away
        const cur = fbRef.current;
        const t = cur?.target;
        if (t && cur) {
          const scale = cur.pixel_scale_arcsec / 3600;
          let best: number | null = null;
          let bd = (2.5 * scale) ** 2;
          for (const s of a.sources) {
            const d = ((s.ra - t.ra_now) * Math.cos((t.dec_now * Math.PI) / 180)) ** 2 + (s.dec - t.dec_now) ** 2;
            if (d < bd) {
              bd = d;
              best = s.id;
            }
          }
          setSelected(best);
        }
      })
      .catch(() => !ac.signal.aborted && setAnalysis(null))
      .finally(() => !ac.signal.aborted && setAnalysisLoading(false));
    return () => ac.abort();
  }, [req, fbReady]);
  useEffect(() => {
    setAnalysis(null);
    setSelected(null);
    setCands(null);
    setFocus(null);
  }, [req]);

  // ---- known asteroids (SkyBoT) ---------------------------------------------------------------
  useEffect(() => {
    if (!fbReady) return;
    const ac = new AbortController();
    loadAsteroids(req, ac.signal).then((a) => !ac.signal.aborted && setAsteroids(a));
    return () => ac.abort();
  }, [req, fbReady]);

  useEffect(() => {
    if (!showGaia || !fbReady || gaiaField) return;
    const ac = new AbortController();
    loadGaia(req, ac.signal).then((g) => !ac.signal.aborted && setGaiaField(g));
    return () => ac.abort();
  }, [showGaia, req, fbReady, gaiaField]);
  useEffect(() => setGaiaField(null), [req]);

  // ---- ML candidates: server scores, then re-scored in the browser with onnxruntime-web --------
  const analysisReady = analysis !== null;
  useEffect(() => {
    if (!analysisReady) return;
    const ac = new AbortController();
    setCandLoading(true);
    setCandErr(null);
    loadCandidates(req, ac.signal)
      .then(async (c) => {
        setCands(c);
        setCandLoading(false);
        const withStamps = c.candidates.filter((x) => x.stamp);
        if (!withStamps.length) return;
        setBrowserState("running");
        try {
          // The in-browser model needs an 11 MB WASM runtime. Wait until the viewer has drawn and the browser is
          // idle, so that download and compile do not compete with the first frames.
          await new Promise<void>((res) =>
            setTimeout(() => {
              if ("requestIdleCallback" in window) window.requestIdleCallback(() => res(), { timeout: 3000 });
              else res();
            }, 800),
          );
          if (ac.signal.aborted) return;
          const s = await scoreStamps(withStamps.map((x) => x.stamp!));
          if (ac.signal.aborted) return;
          withStamps.forEach((x, i) => (x.browserScore = s[i]));
          setCands({ ...c, candidates: [...c.candidates] });
          setBrowserState("done");
        } catch {
          setBrowserState("error");
        }
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setCandErr(e instanceof Error ? e.message : String(e));
        setCandLoading(false);
      });
    return () => ac.abort();
  }, [req, analysisReady]);

  // ---- URL state (shareable) ---------------------------------------------------
  useEffect(() => {
    const p = new URLSearchParams();
    if (target) p.set("target", target);
    else if (raQ && decQ) {
      p.set("ra", raQ);
      p.set("dec", decQ);
      if (nameQ) p.set("name", nameQ);
    }
    p.set("fov", String(fov));
    p.set("band", band);
    if (view !== "flip") p.set("view", view);
    if (embed) p.set("embed", "1");
    const url = `/explore?${p}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
  }, [target, raQ, decQ, nameQ, fov, band, embed, view]);

  // ---- frames for the chosen band ----------------------------------------------
  const frames = useMemo(() => {
    if (!fb) return [];
    return fb.epochs
      .map((e) => ({ e, b: e.bands[band] }))
      .filter(({ e, b }) => b?.data && (showPartial || (band === "all" ? e.n_exposures >= 6 : b.n >= 3)));
  }, [fb, band, showPartial]);

  const timeline: TimelineFrame[] = useMemo(
    () =>
      frames.map(({ e, b }) => ({
        key: String(e.index),
        year: e.year_mid,
        label: e.date_mid,
        sub: `${b!.n} exp`,
        partial: band === "all" ? e.n_exposures < 6 : b!.n < 3,
      })),
    [frames, band],
  );

  // reset indices when the frame set changes
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(frames.length - 1, 0)));
    // default blink pair: maximise baseline × √(harmonic mean of exposure counts) ∝ motion S/N
    if (frames.length > 1) {
      let best = -1;
      let pa = 0;
      let pb = frames.length - 1;
      for (let i = 0; i < frames.length; i++)
        for (let j = i + 1; j < frames.length; j++) {
          const na = frames[i].b!.n;
          const nb = frames[j].b!.n;
          const score = (frames[j].e.year_mid - frames[i].e.year_mid) * Math.sqrt((na * nb) / (na + nb));
          if (score > best) {
            best = score;
            pa = i;
            pb = j;
          }
        }
      setBlinkA(pa);
      setBlinkB(pb);
    }
  }, [frames]);

  const arrays = useMemo(() => frames.map(({ b }) => decodeF32(b!.data!)), [frames]);
  const levels = useMemo(() => (arrays.length ? autoLevels(arrays) : null), [arrays]);

  // ---- playback -------------------------------------------------------------------
  const blinkPhase = useRef(0);
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const ms = 1000 / Number(speed);
    const t = setInterval(() => {
      if (blink) {
        blinkPhase.current ^= 1;
        setIndex(blinkPhase.current ? blinkB : blinkA);
      } else {
        setIndex((i) => {
          if (i + 1 >= frames.length) {
            if (!loop) {
              setPlaying(false);
              return i;
            }
            return 0;
          }
          return i + 1;
        });
      }
    }, blink ? Math.max(ms * 0.6, 120) : ms);
    return () => clearInterval(t);
  }, [playing, speed, loop, blink, blinkA, blinkB, frames.length]);

  useEffect(() => {
    if (blink) setIndex(blinkA);
  }, [blink, blinkA]);

  // ---- keyboard shortcuts ------------------------------------------------------------
  const step = useCallback(
    (d: number) => {
      setPlaying(false);
      setIndex((i) => (i + d + frames.length) % Math.max(frames.length, 1));
    },
    [frames.length],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (palette.open) return;
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key.toLowerCase() === "b") {
        setBlink((b) => !b);
        setPlaying(true);
      } else if (e.key.toLowerCase() === "v") {
        setView((v) => (v === "flip" ? "stack" : v === "stack" ? "diff" : v === "diff" ? "motion" : "flip"));
      } else if (/^[0-6]$/.test(e.key)) {
        setBand(e.key === "0" ? "all" : (`D${e.key}` as BandKey));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, palette.open]);

  // ---- render current frame ------------------------------------------------------------
  const cur = frames[Math.min(index, frames.length - 1)];
  const curArr = arrays[Math.min(index, arrays.length - 1)];
  const n = fb?.width ?? 0;
  const A = Math.max(0, Math.min(blinkA, arrays.length - 1));
  const B = Math.max(0, Math.min(blinkB, arrays.length - 1));
  // derived image for the non-flipbook views
  const derived = useMemo(() => {
    if (!arrays.length || !n) return null;
    if (view === "stack") {
      const out = new Float32Array(n * n);
      const wsum = new Float32Array(n * n);
      frames.forEach(({ b }, k) => {
        const w = 1 / Math.max((b!.noise ?? 1) ** 2, 1e-30);
        const a = arrays[k];
        for (let i = 0; i < a.length; i++)
          if (Number.isFinite(a[i])) {
            out[i] += a[i] * w;
            wsum[i] += w;
          }
      });
      for (let i = 0; i < out.length; i++) out[i] = wsum[i] > 0 ? out[i] / wsum[i] : NaN;
      return out;
    }
    if (view === "diff") {
      // per-detector difference in S/N units with photometric scaling, then combined over detectors —
      // static stars cancel even when the two epochs have different noise or wavelength coverage
      const ea = frames[A]?.e;
      const eb = frames[B]?.e;
      if (!ea || !eb) return null;
      const dets = band === "all" ? (["D1", "D2", "D3", "D4", "D5", "D6"] as BandKey[]) : [band];
      const sum = new Float32Array(n * n);
      const cnt = new Float32Array(n * n);
      for (const d of dets) {
        const fa = ea.bands[d];
        const fbb = eb.bands[d];
        if (!fa?.data || !fbb?.data) continue;
        const a = decodeF32(fa.data);
        const b = decodeF32(fbb.data);
        const na = fa.noise ?? 1;
        const nb = fbb.noise ?? 1;
        const ratios: number[] = [];
        for (let i = 0; i < a.length; i++) if (a[i] > 15 * na && b[i] > 15 * nb) ratios.push(b[i] / a[i]);
        ratios.sort((p, q) => p - q);
        const k = ratios.length >= 12 ? Math.min(2, Math.max(0.5, ratios[Math.floor(ratios.length / 2)])) : 1;
        const den = Math.hypot(k * na, nb);
        for (let i = 0; i < a.length; i++) {
          const v = (b[i] - k * a[i]) / den;
          if (Number.isFinite(v)) {
            sum[i] += v;
            cnt[i] += 1;
          }
        }
      }
      const out = new Float32Array(n * n);
      for (let i = 0; i < out.length; i++) out[i] = cnt[i] > 0 ? sum[i] / Math.sqrt(cnt[i]) : NaN;
      return subtractBackground(out, n);
    }
    return null;
  }, [view, arrays, frames, n, A, B, band]);
  const stackLevels = useMemo(() => (view === "stack" && derived ? autoLevels([derived]) : null), [view, derived]);

  const rgba = useMemo(() => {
    if (!levels || !n || !arrays.length) return null;
    const opts = { mode, levels, contrast, brightness, cmap };
    if (view === "stack" && derived && stackLevels) return renderRGBA(derived, n, { ...opts, levels: stackLevels });
    if (view === "diff" && derived) return renderDiff(derived, n, 1 / contrast, EARLY, LATE); // derived is in σ
    if (view === "motion") return renderComposite(arrays[A], arrays[B], n, opts, EARLY, LATE);
    if (!curArr) return null;
    return renderRGBA(curArr, n, opts);
  }, [view, derived, stackLevels, curArr, levels, n, mode, contrast, brightness, cmap, arrays, A, B]);

  const valueAt = useCallback(
    (x: number, y: number) => {
      const arr = view === "stack" || view === "diff" ? derived : curArr;
      return arr && x >= 0 && y >= 0 && x < n && y < n ? arr[y * n + x] : null;
    },
    [curArr, derived, view, n],
  );

  const markers: Marker[] = useMemo(() => {
    if (!fb?.target) return [];
    const t = fb.target;
    const m: Marker[] = [];
    const yr = cur?.e.year_mid ?? 2026;
    const dt = yr - t.ref_epoch;
    const dec = t.dec + (t.pmdec * dt) / 3.6e6;
    const ra = t.ra + (t.pmra * dt) / 3.6e6 / Math.cos(((t.dec + dec) / 2) * (Math.PI / 180));
    m.push({ ra, dec, kind: "target" });
    const pmTot = Math.hypot(t.pmra, t.pmdec);
    if (pmTot > 500) m.push({ ra: t.ra, dec: t.dec, kind: "catalog", label: "J2000 position", color: "rgba(255,255,255,.55)" });
    return m;
  }, [fb, cur]);

  const wcs = useMemo(() => (fb ? { crval: fb.wcs.crval, crpix: fb.wcs.crpix, cdelt: fb.wcs.cdelt } : null), [fb]);
  const bandInfo = cur?.b;

  const selectedSrc = analysis?.sources.find((s) => s.id === selected) ?? null;
  const arrows: Arrow[] = useMemo(() => {
    if (!analysis || !wcs || !fb || !showArrows || !frames.length) return [];
    const scale = fb.pixel_scale_arcsec * 1000; // mas per px
    const y0 = frames[0].e.year_mid;
    const y1 = frames[frames.length - 1].e.year_mid;
    const ids = new Set(analysis.movers);
    if (selected !== null) ids.add(selected);
    return analysis.sources
      .filter((s) => ids.has(s.id) && s.pmra !== undefined)
      .map((s) => {
        const [px, py] = world2pix(wcs, s.ra, s.dec);
        const vx = -(s.pmra ?? 0) / scale;
        const vy = (s.pmdec ?? 0) / scale;
        const t0 = y0 - (s.t_ref ?? 2026);
        const x0 = px + vx * t0;
        const yy0 = py + vy * t0;
        return {
          id: String(s.id),
          x0,
          y0: yy0,
          x1: x0 + vx * (y1 - y0) * exaggerate,
          y1: yy0 + vy * (y1 - y0) * exaggerate,
          label: `${((s.pm ?? 0) / 1000).toFixed(1)}″/yr`,
          color: s.id === selected ? "var(--late)" : "var(--accent)",
        };
      });
  }, [analysis, wcs, fb, showArrows, frames, exaggerate, selected]);

  const allMarkers: Marker[] = useMemo(() => {
    const m = [...markers];
    if (gaiaField && showGaia) {
      const yr = cur?.e.year_mid ?? 2026;
      const dt = yr - gaiaField.epoch;
      for (const g of gaiaField.sources) {
        const dec = g.dec + ((g.pmdec ?? 0) * dt) / 3.6e6;
        const ra = g.ra + ((g.pmra ?? 0) * dt) / 3.6e6 / Math.cos((dec * Math.PI) / 180);
        const fast = Math.hypot(g.pmra ?? 0, g.pmdec ?? 0) > 300;
        m.push({ ra, dec, kind: "dot", color: fast ? "var(--accent)" : "rgba(120,190,255,.7)" });
      }
    }
    if (asteroids && showAsteroids && cur && view === "flip") {
      const seen = new Set<string>();
      for (const v of asteroids.visits) {
        if (v.mjd < cur.e.mjd_start - 0.01 || v.mjd > cur.e.mjd_end + 0.01) continue;
        for (const o of v.objects) {
          if (seen.has(o.name)) continue;
          seen.add(o.name);
          m.push({ ra: o.ra, dec: o.dec, kind: "candidate", color: "rgba(250,204,21,.85)", label: `${o.name}${o.vmag ? ` V${o.vmag.toFixed(1)}` : ""}` });
        }
      }
    }
    if (selectedSrc)
      m.push({ ra: selectedSrc.ra, dec: selectedSrc.dec, kind: "source", color: "var(--late)", label: `#${selectedSrc.id}` });
    return m;
  }, [markers, selectedSrc, asteroids, showAsteroids, cur, view, gaiaField, showGaia]);

  const onPixelClick = useCallback(
    (x: number, y: number) => {
      if (!analysis || !wcs) return;
      let best: number | null = null;
      let bd = 2.5 * 2.5;
      for (const s of analysis.sources) {
        const [px, py] = world2pix(wcs, s.ra, s.dec);
        const d = (px - x) ** 2 + (py - y) ** 2;
        if (d < bd) {
          bd = d;
          best = s.id;
        }
      }
      if (best !== null) {
        setSelected(best);
        setRightTab("source");
        setPanel((p) => (p ? "info" : p));
      }
    },
    [analysis, wcs],
  );

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const title = fb?.target?.name ?? nameQ ?? (raQ && decQ ? `${fmtRA(+raQ, 1)} ${fmtDec(+decQ, 0)}` : target ?? "");

  const pairLabel = frames.length > 1 ? `${frames[A]?.e.date_mid} → ${frames[B]?.e.date_mid}` : "";
  const stamp =
    view !== "flip" && frames.length ? (
      <div className="rounded-lg bg-black/55 px-2.5 py-1.5 text-white backdrop-blur-md">
        <div className="num text-[13px] font-medium leading-5 tracking-tight">
          {view === "stack" ? `Stack of ${frames.length} epochs` : pairLabel}
        </div>
        <div className="num flex items-center gap-1.5 text-[11px] leading-4 text-white/65">
          {view === "diff" && (
            <>
              <span className="size-2 rounded-full" style={{ background: "rgb(0,150,255)" }} /> brighter in A
              <span className="ml-1 size-2 rounded-full" style={{ background: "rgb(255,105,0)" }} /> brighter in B
            </>
          )}
          {view === "motion" && (
            <>
              <span className="size-2 rounded-full" style={{ background: "rgb(0,150,255)" }} /> A
              <span className="ml-1 size-2 rounded-full" style={{ background: "rgb(255,105,0)" }} /> B · static = white
            </>
          )}
          {view === "stack" && <>{band === "all" ? "D1–D6" : band} · inverse-variance weighted</>}
        </div>
      </div>
    ) : (
      cur &&
      bandInfo && (
    <motion.div
      key={cur.e.index + band}
      initial={{ opacity: 0.6 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="rounded-lg bg-black/55 px-2.5 py-1.5 text-white backdrop-blur-md"
    >
      <div className="num text-[15px] font-medium leading-5 tracking-tight">{cur.e.date_mid}</div>
      <div className="num text-[11px] leading-4 text-white/65">
        {band === "all" ? "D1–D6 · 0.75–5.0 µm" : `${band} · ${bandInfo.wave_min_um.toFixed(2)}–${bandInfo.wave_max_um.toFixed(2)} µm`}
        {" · "}
        {bandInfo.n} exp
      </div>
    </motion.div>
      )
    );

  const displayPanel = (
    <DisplayPanel
      band={band}
      onBand={setBand}
      bands={BANDS}
      fb={fb}
      fov={fov}
      onFov={setFov}
      fovOptions={FOV_OPTIONS as unknown as number[]}
      mode={mode}
      onMode={setMode}
      contrast={contrast}
      onContrast={setContrast}
      brightness={brightness}
      onBrightness={setBrightness}
      cmap={cmap}
      onCmap={setCmap}
      smooth={smooth}
      onSmooth={setSmooth}
      showPartial={showPartial}
      onShowPartial={setShowPartial}
    />
  );
  const overlayControls = (
    <div className="border-t border-border px-4 py-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-faint">Motion overlay</h3>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-muted">
          <input type="checkbox" checked={showArrows} onChange={(e) => setShowArrows(e.target.checked)} className="size-3.5" />
          Arrows
        </label>
      </div>
      <div className="mb-1 flex justify-between text-[12px]">
        <span className="text-fg-muted">Exaggerate</span>
        <span className="num text-fg-faint">×{exaggerate}</span>
      </div>
      <Slider min={1} max={50} step={1} value={[exaggerate]} onValueChange={([v]) => setExaggerate(v)} />
      <label className="mt-3 flex items-center justify-between gap-2 text-[12px] text-fg-muted">
        <span>
          Known asteroids
          <span className="block text-[11px] text-fg-faint">
            {asteroids ? `${asteroids.n_objects} in this field during SPHEREx visits (SkyBoT, V ≤ ${asteroids.vmax})` : "SkyBoT"}
          </span>
        </span>
        <input type="checkbox" checked={showAsteroids} onChange={(e) => setShowAsteroids(e.target.checked)} className="size-3.5" />
      </label>
      <label className="mt-3 flex items-center justify-between gap-2 text-[12px] text-fg-muted">
        <span>
          Gaia DR3 overlay
          <span className="block text-[11px] text-fg-faint">
            {gaiaField ? `${gaiaField.sources.length} stars (G < 19), moved to each epoch; lime = faster than 0.3″/yr` : "Positions propagated to each epoch"}
          </span>
        </span>
        <input type="checkbox" checked={showGaia} onChange={(e) => setShowGaia(e.target.checked)} className="size-3.5" />
      </label>
      <p className="mt-2 text-[11px] leading-4 text-fg-faint">
        Arrows show the fitted motion across the baseline, lengthened ×{exaggerate} so sub-pixel motion is visible.
      </p>
    </div>
  );
  const infoBody = <InfoPanel fb={fb} epoch={cur?.e ?? null} band={band} source={source} />;
  const infoPanel = (
    <div>
      <div className="sticky top-0 z-10 border-b border-border bg-glass px-3 py-2 backdrop-blur-xl">
        <Segmented
          size="sm"
          className="w-full"
          value={rightTab}
          onChange={setRightTab}
          options={[
            { value: "info", label: "Info" },
            {
              value: "motion",
              label: (
                <span>
                  Motion{analysis && analysis.movers.length ? <span className="num ml-1 text-accent">{analysis.movers.length}</span> : null}
                </span>
              ),
            },
            { value: "ml", label: "Candidates" },
            { value: "source", label: "Source" },
          ]}
        />
      </div>
      {rightTab === "info" && infoBody}
      {rightTab === "motion" && (
        <MotionPanel
          analysis={analysis}
          loading={analysisLoading}
          selected={selected}
          onSelect={(id) => {
            setSelected(id);
            setRightTab("source");
          }}
        />
      )}
      {rightTab === "ml" && (
        <CandidatesPanel
          data={cands}
          loading={candLoading}
          error={candErr}
          browserState={browserState}
          selectedRank={focus?.rank ?? null}
          sources={new Map((analysis?.sources ?? []).map((s) => [s.id, s]))}
          onSelect={(c) => {
            setFocus((f) => (f?.rank === c.rank ? null : c));
            if (c.source_id !== undefined) setSelected(c.source_id);
            // blink the best pair around the candidate
            if (cands?.pair && frames.length > 1) {
              const near = (y: number) =>
                frames.reduce((bi, f, i) => (Math.abs(f.e.year_mid - y) < Math.abs(frames[bi].e.year_mid - y) ? i : bi), 0);
              setBlinkA(near(cands.pair.a_year));
              setBlinkB(near(cands.pair.b_year));
            }
            setView("flip");
            setBlink(true);
            setPlaying(true);
          }}
        />
      )}
      {rightTab === "source" && (
        <>
          <SourcePanel source={selectedSrc} req={req} onClose={() => setSelected(null)} />
          {selectedSrc && <SpectrumSection source={selectedSrc} req={req} />}
          {selectedSrc && selectedSrc.track && selectedSrc.track.length > 1 && fb && (
            <div className="border-t border-border px-4 py-3.5">
              <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-faint">Motion fit</h3>
              <MotionFit source={selectedSrc} pixelScale={fb.pixel_scale_arcsec} />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <TooltipProvider>
      <main className="fixed inset-0 overflow-hidden bg-sky text-fg">
        {/* sky */}
        <div
          className={cn(
            "absolute inset-x-0 px-4",
            embed ? "bottom-[92px] top-3" : "bottom-[150px] top-[112px] md:px-[300px] lg:top-[64px] xl:px-[328px]",
            !embed && (blink ? "md:bottom-[140px]" : "md:bottom-[96px]"),
          )}
        >
          {fb && !error ? (
            <SkyView
              rgba={rgba}
              n={n}
              wcs={wcs}
              pixelScale={fb.pixel_scale_arcsec}
              smooth={smooth}
              markers={allMarkers}
              arrows={arrows}
              onPixelClick={onPixelClick}
              zoom={focus && wcs ? (() => {
                const [zx, zy] = world2pix(wcs, focus.ra, focus.dec);
                return { x: zx, y: zy, f: Math.max(1, Math.min(4, n / 18)) };
              })() : null}
              stamp={stamp}
              valueAt={valueAt}
              unit={view === "diff" || band === "all" ? "σ (S/N)" : "MJy/sr"}
              loading={loading}
            />
          ) : (
            <LoadingState job={job} error={error} loading={loading} />
          )}
        </div>

        {/* mobile summary (fills the space under the square image on tall screens) */}
        {fb && cur && !embed && (
          <div className="absolute inset-x-4 bottom-[104px] z-10 md:hidden">
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="truncate font-medium">{fb.target?.name}</span>
              <span className="num shrink-0 text-fg-faint">
                {fmtRA(fb.ra, 1)} {fmtDec(fb.dec, 0)}
              </span>
            </div>
            <div className="num mt-0.5 text-[11px] text-fg-faint">
              {fb.release} · {fb.n_exposures} exposures · {fb.epochs.length} epochs
            </div>
          </div>
        )}

        {/* top bar */}
        {!embed && (
        <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-2 px-3 sm:px-4">
          <Link href="/" className="flex items-center gap-2 rounded-lg pr-2 text-fg" aria-label="Blink home">
            <Logo />
          </Link>
          <button
            onClick={() => palette.setOpen(true)}
            className="glass group ml-1 flex h-9 min-w-0 max-w-[560px] flex-1 items-center gap-2.5 rounded-xl px-3 text-left lg:max-w-[400px] 2xl:max-w-[560px]"
          >
            <Search className="size-4 shrink-0 text-fg-faint" />
            <span className="truncate text-[13px] font-medium">{title || "Search the sky"}</span>
            {fb && (
              <span className="num hidden truncate text-[12px] text-fg-faint lg:inline">
                {fmtRA(fb.ra, 1)} {fmtDec(fb.dec, 0)}
              </span>
            )}
            <span className="ml-auto hidden items-center gap-1 sm:flex">
              <Kbd>
                <CmdIcon className="size-2.5" />
              </Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <Tip content={copied ? "Copied!" : "Copy shareable link"}>
              <Button size="icon" variant="ghost" onClick={share} aria-label="Copy link">
                <Link2 />
              </Button>
            </Tip>
            <Tip content="Toggle theme">
              <span>
                <ThemeToggle />
              </span>
            </Tip>
            <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
              <Link href="/methods">Methods</Link>
            </Button>
          </div>
        </header>
        )}

        {/* desktop side panels */}
        {!embed && (
          <>
        <aside className="absolute bottom-[100px] left-4 top-[72px] z-10 hidden w-[272px] md:block xl:w-[296px]">
          <div className="glass max-h-full overflow-y-auto rounded-2xl">
            {displayPanel}
            {overlayControls}
          </div>
        </aside>
        <aside className="absolute bottom-[100px] right-4 top-[72px] z-10 hidden w-[272px] md:block xl:w-[296px]">
          <div className="glass max-h-full overflow-y-auto rounded-2xl">{infoPanel}</div>
        </aside>
          </>
        )}

        {/* mobile panel toggles + sheets */}
        <div className={cn("absolute right-3 top-[72px] z-20 flex gap-1.5 md:hidden", embed && "hidden")}>
          <Button size="sm" variant={panel === "display" ? "active" : "secondary"} className="glass" onClick={() => setPanel(panel === "display" ? null : "display")} aria-label="Display settings">
            <SlidersHorizontal /> <span className="hidden sm:inline">Display</span>
          </Button>
          <Button size="sm" variant={panel === "info" ? "active" : "secondary"} className="glass" onClick={() => setPanel(panel === "info" ? null : "info")} aria-label="Info">
            <Info /> <span className="hidden sm:inline">Info</span>
          </Button>
        </div>
        <AnimatePresence>
          {panel && (
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="glass absolute inset-x-3 bottom-[100px] z-30 max-h-[56dvh] overflow-y-auto rounded-2xl md:hidden"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-bg-elev/80 px-4 py-2 backdrop-blur">
                <span className="text-[13px] font-medium">{panel === "display" ? "Display" : "Info"}</span>
                <button className="rounded-md p-1 text-fg-muted hover:text-fg" onClick={() => setPanel(null)} aria-label="Close panel">
                  <X className="size-4" />
                </button>
              </div>
              {panel === "display" ? (
                <>
                  {displayPanel}
                  {overlayControls}
                </>
              ) : (
                infoPanel
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* view mode switcher */}
        {fb && !embed && (
          <div className="absolute left-3 top-[72px] z-20 lg:left-auto lg:right-[156px] lg:top-[14px]">
            <Segmented
              className="glass"
              size="sm"
              value={view}
              onChange={(v) => {
                setView(v);
                if (v !== "flip") setPlaying(false);
              }}
              options={[
                { value: "flip", label: "Flipbook", title: "Play the epochs (V)" },
                { value: "stack", label: "Stack", title: "Inverse-variance sum of all shown epochs" },
                { value: "diff", label: "Difference", title: "B − A: what changed" },
                { value: "motion", label: "Motion", title: "A in blue, B in orange — movers show as colour pairs" },
              ]}
            />
          </div>
        )}

        {/* player */}
        <div className={cn("absolute inset-x-3 bottom-3 z-20 mx-auto max-w-[860px]", !embed && "md:inset-x-[300px] xl:inset-x-[328px]")}>
          {timeline.length > 0 && view !== "flip" ? (
            <div className="glass flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl px-4 py-3 text-[12px]">
              {view === "stack" ? (
                <span className="text-fg-muted">
                  All {frames.length} epochs, weighted by their noise. Switch to <b className="text-fg">Flipbook</b> to play them.
                </span>
              ) : (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="num rounded bg-early px-1 text-[10px] font-bold text-black">A</span>
                    <select className="num rounded-md border border-border bg-bg-elev px-1.5 py-0.5 text-fg" value={A} onChange={(e) => setBlinkA(Number(e.target.value))}>
                      {timeline.map((f, i) => (
                        <option key={f.key} value={i}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="num rounded bg-late px-1 text-[10px] font-bold text-black">B</span>
                    <select className="num rounded-md border border-border bg-bg-elev px-1.5 py-0.5 text-fg" value={B} onChange={(e) => setBlinkB(Number(e.target.value))}>
                      {timeline.map((f, i) => (
                        <option key={f.key} value={i}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="num text-fg-faint">Δt = {(Math.abs((timeline[B]?.year ?? 0) - (timeline[A]?.year ?? 0)) * 365.25).toFixed(0)} d</span>
                  <span className="ml-auto hidden text-fg-faint lg:inline">
                    {view === "diff" ? "Static stars cancel; movers leave a blue/orange pair." : "Static stars look white; movers split into blue → orange."}
                  </span>
                </>
              )}
            </div>
          ) : timeline.length > 0 ? (
            <PlayerBar
              frames={timeline}
              index={Math.min(index, timeline.length - 1)}
              onIndex={(i) => {
                setIndex(i);
                if (!blink) setPlaying(false);
              }}
              playing={playing}
              onPlaying={setPlaying}
              speed={speed}
              onSpeed={setSpeed}
              loop={loop}
              onLoop={setLoop}
              blink={blink}
              onBlink={(b) => {
                setBlink(b);
                setPlaying(true);
              }}
              blinkA={blinkA}
              blinkB={blinkB}
              onBlinkA={setBlinkA}
              onBlinkB={setBlinkB}
            />
          ) : (
            <div className="glass h-[58px] rounded-2xl">
              {fb && !loading && (
                <div className="flex h-full items-center justify-center text-[13px] text-fg-muted">
                  No {band} epochs here.{" "}
                  <button className="ml-1 text-accent" onClick={() => setShowPartial(true)}>
                    Include short visits
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <CommandPalette open={palette.open} onOpenChange={palette.setOpen} fov={fov} />
      </main>
    </TooltipProvider>
  );
}

function LoadingState({ job, error, loading }: { job: Job | null; error: string | null; loading: boolean }) {
  if (error)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="glass max-w-md rounded-2xl p-6 text-center">
          <div className="text-[15px] font-medium">Couldn’t load SPHEREx data</div>
          <p className="mt-2 text-[13px] text-fg-muted">{error}</p>
          <p className="mt-3 text-[12px] text-fg-faint">
            IRSA can be slow or briefly unavailable. Try again in a minute, or pick a challenge target from ⌘K (they are cached).
          </p>
        </div>
      </div>
    );
  const stageText: Record<string, string> = {
    queued: "Queued",
    search: "Searching IRSA for SPHEREx exposures",
    download: "Downloading cutouts from IRSA",
    reproject: "Aligning exposures onto a common grid",
    coadd: "Co-adding epochs",
  };
  const pct = job && job.n ? Math.round((100 * job.i) / job.n) : null;
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative aspect-square h-full max-h-[calc(100%-8px)] max-w-full">
        <div className="skeleton absolute inset-0 rounded-[3px] opacity-40" />
        {(job || loading) && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="glass w-[min(340px,90%)] rounded-2xl p-5">
              <div className="text-[13px] font-medium">{job ? stageText[job.stage] ?? job.stage : "Loading flipbook"}</div>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-fg/10">
                <motion.div
                  className="h-full bg-accent"
                  animate={{ width: pct !== null ? `${pct}%` : ["10%", "60%", "10%"] }}
                  transition={pct !== null ? { duration: 0.3 } : { duration: 1.6, repeat: Infinity }}
                />
              </div>
              {job && job.n > 0 && (
                <div className="num mt-2 text-[11px] text-fg-faint">
                  {job.i} / {job.n} {job.stage === "download" ? "cutouts" : "exposures"}
                </div>
              )}
              {job && <p className="mt-3 text-[12px] text-fg-muted">First look at a new patch of sky takes 1–5 min. After that it’s cached.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
