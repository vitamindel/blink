/** Blink mark: two offset dots (an object seen at two epochs) inside a ring. */
export function Logo({ withText = true }: { withText?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
        <circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeOpacity=".35" />
        <circle cx="8" cy="12.5" r="2.4" fill="var(--early)" />
        <circle cx="14" cy="9.5" r="2.4" fill="var(--accent)" />
      </svg>
      {withText && <span className="text-[15px] font-semibold tracking-tight">Blink</span>}
    </span>
  );
}
