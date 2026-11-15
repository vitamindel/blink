"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { Crosshair, Loader2, MoonStar, Search, Sparkles, Star, SunMedium } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { Kbd } from "@/components/ui/tooltip";
import { resolveQuery, TEST_TARGETS } from "@/lib/api";
import { fmtDec, fmtRA } from "@/lib/utils";

/** Parse "269.45 4.69", "17:57:48.5 +04:41:36", "17h57m48.5s +04d41m36s". */
export function parseCoords(s: string): [number, number] | null {
  const t = s.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  const dec2 = t.match(/^(-?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)$/);
  if (dec2) {
    const ra = parseFloat(dec2[1]);
    const dec = parseFloat(dec2[2]);
    if (ra >= 0 && ra < 360 && dec >= -90 && dec <= 90) return [ra, dec];
  }
  const sexa = t.match(
    /^(\d{1,2})[h: ](\d{1,2})[m: ](\d{1,2}(?:\.\d+)?)s?\s+([+-−]?)(\d{1,2})[d°: ](\d{1,2})[m′': ](\d{1,2}(?:\.\d+)?)[s″"]?$/,
  );
  if (sexa) {
    const ra = 15 * (+sexa[1] + +sexa[2] / 60 + +sexa[3] / 3600);
    const sign = sexa[4] === "-" || sexa[4] === "−" ? -1 : 1;
    const dec = sign * (+sexa[5] + +sexa[6] / 60 + +sexa[7] / 3600);
    if (ra < 360 && Math.abs(dec) <= 90) return [ra, dec];
  }
  return null;
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandPalette({
  open,
  onOpenChange,
  fov,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fov?: number;
}) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const coords = useMemo(() => parseCoords(q), [q]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setErr(null);
    }
  }, [open]);

  const go = (params: Record<string, string>) => {
    const p = new URLSearchParams({ ...params, fov: String(fov ?? 6) });
    router.push(`/explore?${p}`);
    onOpenChange(false);
  };

  const resolveName = async () => {
    setBusy(true);
    setErr(null);
    try {
      const t = await resolveQuery(q);
      if (TEST_TARGETS.some((x) => x.slug === t.slug)) go({ target: t.slug });
      else go({ ra: t.ra_now.toFixed(5), dec: t.dec_now.toFixed(5), name: t.name });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not resolve that name");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[18%] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border-strong bg-bg-elev shadow-2xl"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Jump to a target or coordinates</Dialog.Title>
          <Command shouldFilter={!coords} loop className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4">
              <Search className="size-4 text-fg-faint" />
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="Target name or coordinates — e.g. 08:55:10.8 −07:14:42"
                className="h-12 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-faint"
              />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[360px] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-fg-muted">
                Press enter to look up “{q}” with CDS Sesame.
              </Command.Empty>
              {coords && (
                <Command.Group heading="Coordinates" className="cmdk-group">
                  <Item
                    icon={<Crosshair />}
                    onSelect={() => go({ ra: coords[0].toFixed(5), dec: coords[1].toFixed(5) })}
                    value="coords"
                  >
                    Go to <span className="num">{fmtRA(coords[0])} {fmtDec(coords[1])}</span>
                  </Item>
                </Command.Group>
              )}
              {!coords && (
                <Command.Group heading="Challenge targets" className="cmdk-group">
                  {TEST_TARGETS.map((t) => (
                    <Item key={t.slug} icon={<Star />} value={`${t.name} ${t.kind}`} onSelect={() => go({ target: t.slug })}>
                      <span>{t.name}</span>
                      <span className="ml-auto text-[12px] text-fg-faint">{t.kind}</span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              {q.trim().length > 1 && !coords && (
                <Command.Group heading="Resolve" className="cmdk-group">
                  <Item icon={busy ? <Loader2 className="animate-spin" /> : <Sparkles />} value={`resolve ${q}`} onSelect={resolveName}>
                    Look up “{q}” <span className="ml-auto text-[12px] text-fg-faint">CDS Sesame</span>
                  </Item>
                </Command.Group>
              )}
              <Command.Group heading="Appearance" className="cmdk-group">
                <Item
                  icon={theme === "dark" ? <SunMedium /> : <MoonStar />}
                  value="toggle theme light dark"
                  onSelect={() => {
                    setTheme(theme === "dark" ? "light" : "dark");
                    onOpenChange(false);
                  }}
                >
                  Switch to {theme === "dark" ? "light" : "dark"} theme
                </Item>
              </Command.Group>
              {err && <div className="px-3 py-2 text-[12px] text-danger">{err}</div>}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Item({
  children,
  icon,
  onSelect,
  value,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onSelect: () => void;
  value: string;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-fg-muted data-[selected=true]:bg-fg/[0.06] data-[selected=true]:text-fg [&_svg]:size-4"
    >
      {icon}
      {children}
    </Command.Item>
  );
}
