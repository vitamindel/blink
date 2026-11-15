"use client";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn("relative flex w-full touch-none select-none items-center h-5 group", className)}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-[3px] w-full grow overflow-hidden rounded-full bg-fg/[0.12]">
      <SliderPrimitive.Range className="absolute h-full bg-accent" />
    </SliderPrimitive.Track>
    {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
      <SliderPrimitive.Thumb
        key={i}
        className="block h-3.5 w-3.5 rounded-full border border-black/20 bg-white shadow-[0_1px_4px_rgba(0,0,0,.4)] transition-transform group-hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      />
    ))}
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";
