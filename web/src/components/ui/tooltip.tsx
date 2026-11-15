"use client";
import * as T from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

export function Tip({
  content,
  children,
  side = "top",
  kbd,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  kbd?: string;
}) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={8}
          className={cn(
            "z-50 flex items-center gap-2 rounded-md border border-border-strong bg-bg-elev px-2 py-1 text-[12px] text-fg shadow-xl",
            "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
          )}
        >
          {content}
          {kbd && <Kbd>{kbd}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "num inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border-strong bg-fg/[0.06] px-1 text-[10px] text-fg-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
