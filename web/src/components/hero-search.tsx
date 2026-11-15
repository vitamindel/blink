"use client";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseCoords } from "@/components/command-palette";
import { resolveQuery, TEST_TARGETS } from "@/lib/api";

export function HeroSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = q.trim();
    if (!s) {
      router.push("/explore?target=wise-0855&fov=6&band=D6");
      return;
    }
    const c = parseCoords(s);
    if (c) {
      router.push(`/explore?ra=${c[0].toFixed(5)}&dec=${c[1].toFixed(5)}&fov=6`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const t = await resolveQuery(s);
      if (TEST_TARGETS.some((x) => x.slug === t.slug)) router.push(`/explore?target=${t.slug}&fov=6`);
      else router.push(`/explore?ra=${t.ra_now.toFixed(5)}&dec=${t.dec_now.toFixed(5)}&name=${encodeURIComponent(t.name)}&fov=6`);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not resolve that name");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={go}>
      <div className="flex h-12 items-center gap-2 rounded-xl border border-border-strong bg-bg-elev/80 pl-4 pr-1.5 shadow-sm backdrop-blur focus-within:border-accent/60">
        <Search className="size-4 shrink-0 text-fg-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Object name or RA Dec — e.g. 08 55 10.8 −07 14 42"
          className="num h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:font-sans placeholder:text-fg-faint"
          aria-label="Object name or coordinates"
        />
        <button
          type="submit"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-[14px] font-medium text-accent-fg hover:opacity-90"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <>Blink <ArrowRight className="size-4" /></>}
        </button>
      </div>
      {err && <p className="mt-2 text-[12px] text-danger">{err}</p>}
    </form>
  );
}
