"use client";
import { useEffect, useRef, useState } from "react";
import { Segmented } from "@/components/ui/segmented";

// Aladin Lite v3 (CDS) — loaded on demand, only when this panel is shown.
const ALADIN_JS = "https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js";
const SURVEYS = {
  wise: { id: "CDS/P/allWISE/color", label: "AllWISE" },
  twomass: { id: "CDS/P/2MASS/color", label: "2MASS" },
  dss: { id: "CDS/P/DSS2/color", label: "DSS" },
} as const;

type AladinNS = {
  init: Promise<void>;
  aladin: (el: HTMLElement, opts: Record<string, unknown>) => {
    setImageSurvey: (id: string) => void;
    gotoRaDec: (ra: number, dec: number) => void;
    setFoV: (deg: number) => void;
    addOverlay: (o: unknown) => void;
  };
  graphicOverlay: (o: Record<string, unknown>) => { add: (s: unknown) => void };
  polygon: (pts: [number, number][]) => unknown;
  circle: (ra: number, dec: number, r: number, o?: Record<string, unknown>) => unknown;
};

let loading: Promise<AladinNS> | null = null;
function loadAladin(): Promise<AladinNS> {
  // the npm build is an ES module (default export A), not a window global
  if (!loading) {
    loading = (import(/* webpackIgnore: true */ ALADIN_JS as string) as Promise<{ default: AladinNS }>).then(async (m) => {
      const A = m.default ?? (window as unknown as { A: AladinNS }).A;
      await A.init;
      return A;
    });
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Sky context from other surveys around the field, with the SPHEREx field of view drawn on it. */
export function SkyContext({ ra, dec, fovDeg }: { ra: number; dec: number; fovDeg: number }) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<ReturnType<AladinNS["aladin"]> | null>(null);
  const [survey, setSurvey] = useState<keyof typeof SURVEYS>("wise");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  useEffect(() => {
    if (state === "idle") return;
    let dead = false;
    const node = el.current;
    loadAladin()
      .then((A) => {
        if (dead || !el.current) return;
        // CDS servers can be unreachable; never let that break the viewer
        window.addEventListener(
          "unhandledrejection",
          (e) => {
            if (String(e.reason).includes("Failed to fetch")) {
              e.preventDefault();
              setState("error");
            }
          },
          { once: true },
        );
        let a: ReturnType<AladinNS["aladin"]>;
        try {
          a = A.aladin(el.current, {
          survey: SURVEYS[survey].id,
          fov: fovDeg * 2.2,
          target: `${ra} ${dec}`,
          showLayersControl: false,
          showGotoControl: false,
          showZoomControl: false,
          showFullscreenControl: false,
          showFrame: false,
          showCooGrid: false,
          showProjectionControl: false,
          showSimbadPointerControl: false,
          showContextMenu: false,
          showCooLocation: false,
          showFov: false,
          showStatusBar: false,
          reticleColor: "#c6f432",
          reticleSize: 18,
          });
        } catch {
          setState("error");
          return;
        }
        const ov = A.graphicOverlay({ color: "#c6f432", lineWidth: 1.5 });
        a.addOverlay(ov);
        const h = fovDeg / 2;
        const c = Math.cos((dec * Math.PI) / 180);
        ov.add(
          A.polygon([
            [ra - h / c, dec - h],
            [ra + h / c, dec - h],
            [ra + h / c, dec + h],
            [ra - h / c, dec + h],
          ]),
        );
        inst.current = a;
        setState("ok");
      })
      .catch(() => !dead && setState("error"));
    return () => {
      dead = true;
      if (node) node.innerHTML = "";
      inst.current = null;
    };
    // re-create when the field changes
  }, [ra, dec, fovDeg, state === "idle"]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    inst.current?.setImageSurvey(SURVEYS[survey].id);
  }, [survey]);

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-black">
        <div ref={el} className="absolute inset-0" />
        {state !== "ok" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[11px] text-white/60">
            {state === "idle" ? (
              <button
                onClick={() => setState("loading")}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] text-white/80 hover:bg-white/10"
              >
                Load sky context
              </button>
            ) : state === "loading" ? (
              "Loading Aladin Lite…"
            ) : (
              "CDS sky survey servers are unreachable right now"
            )}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Segmented
          size="sm"
          value={survey}
          onChange={(v) => setSurvey(v as keyof typeof SURVEYS)}
          options={Object.entries(SURVEYS).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <span className="text-[10px] text-fg-faint">box = SPHEREx field · Aladin Lite (CDS)</span>
      </div>
    </div>
  );
}
