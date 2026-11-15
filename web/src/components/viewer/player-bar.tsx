"use client";
import { ChevronLeft, ChevronRight, Pause, Play, Repeat, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface TimelineFrame {
  key: string;
  year: number;
  label: string; // date
  sub?: string; // e.g. exposure count
  partial?: boolean;
}

export const SPEEDS = ["0.5", "1", "2", "4"] as const;
export type Speed = (typeof SPEEDS)[number];

export function PlayerBar({
  frames,
  index,
  onIndex,
  playing,
  onPlaying,
  speed,
  onSpeed,
  loop,
  onLoop,
  blink,
  onBlink,
  blinkA,
  blinkB,
  onBlinkA,
  onBlinkB,
}: {
  frames: TimelineFrame[];
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speed: Speed;
  onSpeed: (s: Speed) => void;
  loop: boolean;
  onLoop: (l: boolean) => void;
  blink: boolean;
  onBlink: (b: boolean) => void;
  blinkA: number;
  blinkB: number;
  onBlinkA: (i: number) => void;
  onBlinkB: (i: number) => void;
}) {
  const n = frames.length;
  const y0 = n ? frames[0].year : 0;
  const y1 = n ? frames[n - 1].year : 1;
  const span = Math.max(y1 - y0, 1e-3);
  const pos = (i: number) => (n <= 1 ? 50 : 4 + ((frames[i].year - y0) / span) * 92);
  // only label ticks that are far enough apart to stay legible
  const showLabel: boolean[] = [];
  let lastPos = -100;
  for (let i = 0; i < n; i++) {
    const p = pos(i);
    showLabel.push(p - lastPos > 16);
    if (showLabel[i]) lastPos = p;
  }

  return (
    <div className="glass w-full rounded-2xl px-3 py-2.5 sm:px-4">
      <div className="flex items-center gap-1.5 sm:gap-2">
        <Tip content="Previous epoch" kbd="←">
          <Button size="icon-sm" variant="ghost" onClick={() => onIndex((index - 1 + n) % n)} aria-label="Previous epoch">
            <ChevronLeft />
          </Button>
        </Tip>
        <Tip content={playing ? "Pause" : "Play"} kbd="Space">
          <Button
            size="icon"
            variant="primary"
            className="rounded-full"
            onClick={() => onPlaying(!playing)}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="fill-current" /> : <Play className="fill-current translate-x-[1px]" />}
          </Button>
        </Tip>
        <Tip content="Next epoch" kbd="→">
          <Button size="icon-sm" variant="ghost" onClick={() => onIndex((index + 1) % n)} aria-label="Next epoch">
            <ChevronRight />
          </Button>
        </Tip>

        {/* timeline */}
        <div className="relative mx-2 h-10 min-w-0 flex-1">
          <div className="absolute left-0 right-0 top-[15px] h-px bg-border-strong" />
          {frames.map((f, i) => {
            const isA = blink && i === blinkA;
            const isB = blink && i === blinkB;
            const active = i === index;
            return (
              <button
                key={f.key}
                onClick={(e) => {
                  if (blink && e.shiftKey) onBlinkB(i);
                  else if (blink && e.altKey) onBlinkA(i);
                  else onIndex(i);
                }}
                className="group absolute top-0 -translate-x-1/2 flex flex-col items-center outline-none"
                style={{ left: `${pos(i)}%` }}
                aria-label={`Epoch ${f.label}`}
              >
                <span
                  className={cn(
                    "relative mt-[10px] block rounded-full transition-all",
                    active ? "h-[11px] w-[11px] bg-accent" : "h-[7px] w-[7px] mt-[12px] bg-fg-faint group-hover:bg-fg",
                    f.partial && !active && "bg-transparent border border-fg-faint",
                  )}
                >
                  {active && <span className="absolute -inset-1.5 rounded-full bg-accent/25" />}
                </span>
                {(isA || isB) && (
                  <span
                    className={cn(
                      "num absolute -top-[3px] rounded px-1 text-[9px] font-bold leading-[12px]",
                      isA ? "bg-early text-black" : "bg-late text-black",
                    )}
                  >
                    {isA ? "A" : "B"}
                  </span>
                )}
                <span
                  className={cn(
                    "num mt-1 hidden whitespace-nowrap text-[10px]",
                    showLabel[i] && "sm:block",
                    active ? "text-fg" : "text-fg-faint group-hover:text-fg-muted",
                  )}
                >
                  {f.label.slice(0, 7)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="hidden items-center gap-1.5 md:flex">
          <Segmented
            size="sm"
            value={speed}
            onChange={onSpeed}
            options={SPEEDS.map((s) => ({ value: s, label: <span className="num">{s}×</span>, title: `${s} frames/s` }))}
          />
          <Tip content="Loop">
            <Button size="icon-sm" variant={loop ? "active" : "ghost"} onClick={() => onLoop(!loop)} aria-label="Loop">
              <Repeat />
            </Button>
          </Tip>
        </div>
        <Tip content={blink ? "Stop blinking" : "Blink between two epochs"} kbd="B">
          <Button size="sm" variant={blink ? "active" : "outline"} onClick={() => onBlink(!blink)} className="ml-1">
            <Zap className={cn(blink && "fill-current")} />
            <span className="hidden sm:inline">Blink</span>
          </Button>
        </Tip>
      </div>
      {blink && n > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2 text-[12px] text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span className="num rounded bg-early px-1 text-[10px] font-bold text-black">A</span>
            <select
              className="num rounded-md border border-border bg-bg-elev px-1.5 py-0.5 text-[12px] text-fg"
              value={blinkA}
              onChange={(e) => onBlinkA(Number(e.target.value))}
            >
              {frames.map((f, i) => (
                <option key={f.key} value={i}>
                  {f.label}
                </option>
              ))}
            </select>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="num rounded bg-late px-1 text-[10px] font-bold text-black">B</span>
            <select
              className="num rounded-md border border-border bg-bg-elev px-1.5 py-0.5 text-[12px] text-fg"
              value={blinkB}
              onChange={(e) => onBlinkB(Number(e.target.value))}
            >
              {frames.map((f, i) => (
                <option key={f.key} value={i}>
                  {f.label}
                </option>
              ))}
            </select>
          </span>
          <span className="num text-fg-faint">
            Δt = {(Math.abs(frames[blinkB]?.year - frames[blinkA]?.year) * 365.25).toFixed(0)} d
          </span>
        </div>
      )}
    </div>
  );
}
