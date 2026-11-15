"use client";
import { MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || resolvedTheme === "dark";
  return (
    <Button size="icon" variant="ghost" onClick={() => setTheme(dark ? "light" : "dark")} aria-label="Toggle theme">
      {mounted ? dark ? <SunMedium /> : <MoonStar /> : <span className="size-4" />}
    </Button>
  );
}
