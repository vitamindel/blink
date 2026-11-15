import { CirclePlay, FileText, Presentation } from "lucide-react";
import { LINKS } from "@/lib/links";
import { cn } from "@/lib/utils";

const ITEMS = [
  { key: "paper", label: "Research paper", icon: FileText },
  { key: "presentation", label: "Presentation", icon: Presentation },
  { key: "video", label: "Video", icon: CirclePlay },
] as const;

/** Paper / presentation / video buttons. A link that is not set yet looks the same but does nothing when clicked. */
export function ResourceLinks({ large = false }: { large?: boolean }) {
  return (
    <>
      {ITEMS.map(({ key, label, icon: Icon }) => {
        const href = LINKS[key];
        const cls = cn("home-btn", large && "lg");
        // no link yet: same look as the others; it starts working once LINKS has a URL
        if (!href)
          return (
            <button key={key} type="button" className={cls}>
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          );
        return (
          <a key={key} className={cls} href={href} target="_blank" rel="noopener noreferrer">
            <Icon className="size-4" aria-hidden />
            {label}
          </a>
        );
      })}
    </>
  );
}
