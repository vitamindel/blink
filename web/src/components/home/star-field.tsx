"use client";
import { useEffect, useRef } from "react";

/* The field of points behind the homepage. Every point carries its own random numbers and has a place in each scene:
   the celestial sphere SPHEREx maps every six months, a flat patch of sky in which a few points blink between two
   epochs (blue, then orange) like plates in a blink comparator, and faint dust behind the reading sections. The eased
   scroll position picks the two scenes in play and how far the move between them has got; each point leaves at its
   own moment, so a change reads as a flow, not a cut. Canvas 2D, no dependencies. */

const N = 2400;
const MOVERS = 8;
const TAU = Math.PI * 2;
const SPHERE = 0;
const SKY = 1;
const DUST = 2;
const BLINK_S = 1.2; // seconds per plate
const XFADE = 0.14; // fraction of a plate spent cross-fading, so the switch reads as a blink, not a glitch
// ink, soft blue, warm star, epoch 1, epoch 2
const COLOURS = ["rgb(232,238,248)", "rgb(173,220,255)", "rgb(255,214,178)", "rgb(59,143,230)", "rgb(229,102,31)"];

interface Key {
  at: number;
  shape: number;
  x: number;
  y: number;
  s: number;
  a: number;
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const smooth = (x: number) => {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function StarField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const c2 = el?.getContext("2d", { alpha: false });
    if (!el || !c2) return;
    const canvas: HTMLCanvasElement = el;
    const ctx: CanvasRenderingContext2D = c2;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const R = new Float32Array(N * 8);
    const rand = rng(2026);
    for (let i = 0; i < R.length; i++) R[i] = rand();

    let W = 0;
    let H = 0;
    let dpr = 1;
    let keys: Key[] = [];
    const out = new Float32Array(5); // x, y, alpha, size, colour
    const A = new Float32Array(5);
    const B = new Float32Array(5);
    const cur: Key = { at: 0, shape: 0, x: 0.5, y: 0.5, s: 1, a: 1 };

    const docTop = (e: Element) => e.getBoundingClientRect().top + window.scrollY;

    function layout() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5); // points 1-4 px across gain nothing from more
      const vh = window.innerHeight;
      W = Math.round(window.innerWidth * dpr);
      H = Math.round(vh * dpr);
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      const ss = window.innerWidth >= 900 ? 1.05 : 1.25;
      const k: Key[] = [
        { at: 0, shape: SPHERE, x: 0.5, y: 0.5, s: ss, a: 1 },
        { at: vh * 0.3, shape: SPHERE, x: 0.5, y: 0.5, s: ss, a: 1 },
      ];
      const story = document.getElementById("story");
      const panels = document.getElementById("panels");
      const work = document.getElementById("work");
      if (story) {
        const t = docTop(story);
        const len = story.offsetHeight - vh;
        k.push({ at: t + 0.06 * len, shape: SKY, x: 0.5, y: 0.5, s: 1, a: 1 });
        k.push({ at: t + 0.94 * len, shape: SKY, x: 0.5, y: 0.5, s: 1, a: 1 });
      }
      if (panels) k.push({ at: docTop(panels) + vh * 0.15, shape: DUST, x: 0.5, y: 0.5, s: 1, a: 0.8 });
      if (work) {
        const t = docTop(work);
        k.push({ at: t - vh * 0.9, shape: DUST, x: 0.5, y: 0.5, s: 1, a: 0.8 });
        k.push({ at: t - vh * 0.15, shape: SPHERE, x: 0.5, y: 0.5, s: ss * 0.92, a: 0.85 });
      }
      for (let i = 1; i < k.length; i++) k[i].at = Math.max(k[i].at, k[i - 1].at + 1);
      keys = k;
    }

    function place(shape: number, i: number, t: number, k: Key) {
      const o = i * 8;
      const r0 = R[o], r1 = R[o + 1], r2 = R[o + 2], r3 = R[o + 3], r4 = R[o + 4], r5 = R[o + 5], r6 = R[o + 6];
      if (shape === SPHERE) {
        // a celestial sphere: random stars plus a faint graticule of 6 meridians and 5 parallels
        const grid = r2 < 0.3;
        let lon: number;
        let lat: number;
        if (grid) {
          const ring = Math.floor(r3 * 11);
          if (ring < 6) {
            lon = (ring * Math.PI) / 6;
            lat = (r1 * 2 - 1) * (Math.PI / 2);
          } else {
            lat = ((ring - 8) * Math.PI) / 6;
            lon = r0 * TAU;
          }
        } else {
          lon = r0 * TAU;
          lat = Math.asin(r1 * 2 - 1);
        }
        lon += t * 0.05;
        const cl = Math.cos(lat);
        const x3 = cl * Math.sin(lon);
        const y3 = Math.sin(lat);
        const z3 = cl * Math.cos(lon);
        const y4 = y3 * 0.93 - z3 * 0.37; // tilted ~22 degrees towards the viewer
        const z4 = y3 * 0.37 + z3 * 0.93;
        const rad = Math.min(W, H) * 0.36 * k.s;
        const p = 2.6 / (2.6 - z4);
        const depth = (z4 + 1) / 2;
        out[0] = k.x * W + x3 * rad * p;
        out[1] = k.y * H - y4 * rad * p;
        out[2] = grid ? 0.08 + 0.4 * depth : (0.08 + 0.6 * depth) * (0.35 + 0.65 * r4);
        out[3] = (grid ? 1 : 0.8 + 1.6 * r4 ** 4) * p * dpr;
        out[4] = grid ? 1 : r5 < 0.1 ? 2 : 0;
      } else if (shape === SKY) {
        if (i < MOVERS) {
          // a mover's first-visit position; the draw loop adds its second position and the blink between them
          out[0] = (0.12 + 0.76 * r0) * W;
          out[1] = (0.2 + 0.44 * r1) * H;
          out[2] = 1;
          out[3] = 3.4 * dpr;
          out[4] = 3;
        } else {
          const w = t * 0.04 + r6 * TAU;
          const m = r4 ** 5;
          out[0] = (r0 * 1.04 - 0.02) * W + Math.sin(w) * 2 * dpr;
          out[1] = (r1 * 1.04 - 0.02) * H + Math.cos(w) * 2 * dpr;
          out[2] = 0.16 + 0.75 * m + 0.06 * Math.sin(t * 1.3 + r6 * 40);
          out[3] = (0.7 + 2.6 * m) * dpr;
          out[4] = r5 < 0.12 ? 2 : r5 < 0.35 ? 1 : 0;
        }
      } else {
        const w = t * 0.05 + r6 * TAU;
        out[0] = r0 * W + Math.sin(w) * 0.012 * W;
        out[1] = r2 * H + Math.cos(w * 0.8) * 0.012 * H;
        out[2] = r1 < 0.35 ? 0.12 + 0.3 * r4 : 0;
        out[3] = (0.8 + r4) * dpr;
        out[4] = r5 < 0.3 ? 1 : 0;
      }
    }

    let ys = window.scrollY;
    let last = performance.now();
    const t0 = last;
    let raf = 0;
    let shown = false;
    let drawn = 0;

    function draw(now: number) {
      raf = 0;
      const y = window.scrollY;
      let i = 0;
      while (i < keys.length - 2 && ys >= keys[i + 1].at) i++;
      const ka = keys[i];
      const kb = keys[Math.min(i + 1, keys.length - 1)];
      // Behind the reading sections only faint dust drifts, so 30 fps is plenty while the page is not scrolling.
      if (!reduced && shown && ka.shape === DUST && kb.shape === DUST && Math.abs(y - ys) < 0.5 && now - drawn < 32) {
        raf = requestAnimationFrame(draw);
        return;
      }
      drawn = now;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      ys = reduced ? y : ys + (y - ys) * (1 - Math.exp(-dt / 0.14));
      const t = reduced ? 0 : (now - t0) / 1000;
      const f = kb.at > ka.at ? Math.min(Math.max((ys - ka.at) / (kb.at - ka.at), 0), 1) : 1;
      const e = smooth(f);
      cur.x = lerp(ka.x, kb.x, e);
      cur.y = lerp(ka.y, kb.y, e);
      cur.s = lerp(ka.s, kb.s, e);
      cur.a = lerp(ka.a, kb.a, e);
      const mix = ka.shape === kb.shape ? 0 : f;

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      let col = -1;
      for (let n = 0; n < N; n++) {
        const w = mix === 0 ? 0 : smooth((mix - R[n * 8 + 7] * 0.45) / 0.55);
        place(ka.shape, n, t, cur);
        A.set(out);
        if (w > 0) {
          place(kb.shape, n, t, cur);
          B.set(out);
        } else B.set(A);
        const alpha = lerp(A[2], B[2], w) * cur.a;
        if (alpha < 0.01) continue;
        const x = lerp(A[0], B[0], w);
        const yy = lerp(A[1], B[1], w);
        if (x < -20 || x > W + 20 || yy < -20 || yy > H + 20) continue;
        const s = lerp(A[3], B[3], w);
        const c = w < 0.5 ? A[4] : B[4];
        if (c !== col) {
          ctx.fillStyle = COLOURS[c];
          col = c;
        }
        const al = Math.min(alpha, 1);
        if (c !== 3) {
          ctx.globalAlpha = al;
          ctx.fillRect(x - s / 2, yy - s / 2, s, s);
          continue;
        }
        // A mover: both positions stay on screen, joined by a faint dashed track, and the bright marker
        // cross-fades from the first visit (blue) to the second (orange) and back.
        const o = n * 8;
        const d = (30 + 22 * R[o + 3]) * dpr;
        const ang = R[o + 2] * TAU;
        const bx = x + Math.cos(ang) * d;
        const by = yy + Math.sin(ang) * d;
        const ph = reduced ? 0.5 : (t / BLINK_S) % 2; // 0-1 first plate, 1-2 second
        const kB = smooth((ph - 1) / XFADE) * (1 - smooth((ph - 2 + XFADE) / XFADE));
        ctx.globalAlpha = al * 0.45;
        ctx.strokeStyle = COLOURS[0];
        ctx.lineWidth = 1.2 * dpr;
        ctx.setLineDash([3 * dpr, 4 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.2 * dpr;
        for (const [px, py, ci, on] of [
          [x, yy, 3, 1 - kB],
          [bx, by, 4, kB],
        ] as const) {
          ctx.fillStyle = COLOURS[ci];
          ctx.strokeStyle = COLOURS[ci];
          ctx.globalAlpha = al * (0.5 + 0.5 * on);
          ctx.fillRect(px - s / 2, py - s / 2, s, s);
          ctx.globalAlpha = al * (0.22 + 0.6 * on);
          ctx.beginPath();
          ctx.arc(px, py, 9 * dpr, 0, TAU);
          ctx.stroke();
        }
        col = -1;
      }
      if (!shown) {
        shown = true;
        canvas.classList.add("on");
      }
      if (!reduced) raf = requestAnimationFrame(draw);
    }

    const redraw = () => {
      if (reduced && !raf) raf = requestAnimationFrame(draw);
    };
    const relayout = () => {
      layout();
      redraw();
    };
    layout();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", redraw, { passive: true });
    const ro = new ResizeObserver(relayout); // page height changes as images and data arrive
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", redraw);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="home-field" aria-hidden />;
}
