"use client";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import { motion } from "framer-motion";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
}

/** Linear-style segmented control with an animated pill. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className={cn("relative inline-flex rounded-lg bg-fg/[0.05] p-0.5 border border-border", className)}
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          disabled={o.disabled}
          title={o.title}
          className={cn(
            "relative z-0 flex-1 rounded-md px-2.5 font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-30",
            size === "sm" ? "h-6 text-[11px]" : "h-7 text-[12px]",
            value === o.value ? "text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id}`}
              className="absolute inset-0 -z-10 rounded-md bg-bg-elev shadow-[0_1px_2px_rgba(0,0,0,.3)] border border-border-strong"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
