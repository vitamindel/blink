"use client";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TEST_TARGETS } from "@/lib/api";

interface Real {
  name: string;
  kind: string;
  score: number;
  moving?: boolean;
}
interface Metrics {
  threshold: number;
  real_objects: Real[];
}

const MOVER = "#3b8fe6";
const VARIABLE = "#e5661f";

/** MoverNet's score for each challenge target. All five were masked out of training. */
export function ScoreChart() {
  const [m, setM] = useState<Metrics | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/data/ml_metrics.json")
      .then((r) => r.json())
      .then(setM)
      .catch(() => setFailed(true));
  }, []);

  const rows = (m?.real_objects ?? []).filter((r) => r.kind === "target").sort((a, b) => b.score - a.score);
  const thr = m?.threshold ?? 0.5;

  return (
    <div>
      <div className="home-legend">
        <span>
          <i className="sq" style={{ background: MOVER }} />
          Known mover
        </span>
        <span>
          <i className="sq" style={{ background: VARIABLE }} />
          Variable star (doesn’t move)
        </span>
        <span>
          <i className="ln dash" style={{ color: "rgba(232,238,248,0.6)" }} />
          Threshold {thr}
        </span>
      </div>
      <div className="mt-5 grid gap-1">
        {failed && <p className="text-[14px] text-[var(--h-ink-3)]">Could not load the model metrics.</p>}
        {!m && !failed && [0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12 rounded-lg opacity-30" />)}
        {rows.map((r) => {
          const t = TEST_TARGETS.find((x) => x.name === r.name);
          const colour = r.moving ? MOVER : VARIABLE;
          return (
            <Link
              key={r.name}
              href={t ? `/explore?target=${t.slug}&fov=6${t.slug === "wise-0855" ? "&band=D6" : ""}` : "/explore"}
              className="home-score-row group"
              title={`${r.name} scores ${r.score.toFixed(3)}. Click to open it in the viewer.`}
            >
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium text-white">{r.name}</div>
                <div className="truncate text-[12px] text-[var(--h-ink-3)]">{t?.kind}</div>
              </div>
              <div className="relative h-2.5">
                <div className="absolute inset-0 rounded-r bg-white/[0.06]" />
                <div className="bar absolute inset-y-0 left-0 rounded-r" style={{ width: `${r.score * 100}%`, background: colour }} />
                <div
                  className="absolute -inset-y-2 border-l border-dashed border-white/50"
                  style={{ left: `${thr * 100}%` }}
                  aria-hidden
                />
              </div>
              <div className="num flex items-center justify-end gap-1 text-[14px] text-white">
                {r.score.toFixed(2)}
                <ArrowUpRight className="size-3.5 text-[var(--h-ink-3)] opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
