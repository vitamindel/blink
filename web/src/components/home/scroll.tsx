"use client";
import { useEffect, useRef } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Brings every `.reveal` element on the page into focus once it is on screen. */
export function RevealObserver() {
  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>(".home .reveal");
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      items.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }),
      { threshold: 0.15 },
    );
    items.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return null;
}

export interface StoryLine {
  text: React.ReactNode;
  /** visible between these fractions of the section's scroll progress */
  show: [number, number];
}

const FADE = 0.07;
const smooth = (x: number) => {
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
};

/** A tall section with a pinned view: its lines come and go with the section's scroll progress. */
export function StoryTrack({ id, lines, legend }: { id: string; lines: StoryLine[]; legend?: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const items = useRef<(HTMLParagraphElement | null)[]>([]);
  const shows = useRef(lines.map((l) => l.show));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = reducedMotion();
    let raf = 0;
    const update = () => {
      raf = 0;
      const len = el.offsetHeight - window.innerHeight;
      const p = len > 0 ? Math.min(Math.max(-el.getBoundingClientRect().top / len, 0), 1) : 0;
      shows.current.forEach(([a, b], j) => {
        const node = items.current[j];
        if (!node) return;
        const w = smooth((p - a) / FADE) * (1 - smooth((p - (b - FADE)) / FADE));
        const s = node.style;
        s.opacity = w.toFixed(3);
        s.visibility = w < 0.005 ? "hidden" : "visible";
        if (!reduced) {
          const dir = p < a + FADE ? 1 : -1;
          s.filter = w > 0.995 ? "none" : `blur(${((1 - w) * 10).toFixed(1)}px)`;
          s.transform = w > 0.995 ? "none" : `translateY(${(dir * (1 - w) * 18).toFixed(1)}px)`;
        }
        node.setAttribute("aria-hidden", w < 0.5 ? "true" : "false");
      });
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  return (
    <section ref={ref} id={id} className="home-track" aria-label="The idea">
      <div className="home-stick">
        {legend && <div className="home-track-legend">{legend}</div>}
        <div className="home-caption">
          {lines.map((l, j) => (
            <p
              key={j}
              ref={(n) => {
                items.current[j] = n;
              }}
            >
              {l.text}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
