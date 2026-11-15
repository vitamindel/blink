import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { MethodsLive } from "./methods-live";

export const metadata = {
  title: "Methods — Blink",
  description: "Data, pipeline, model card and limitations for Blink, a SPHEREx blink comparator.",
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-14 text-[22px] font-semibold tracking-tight">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[15px] leading-7 text-fg-muted">{children}</p>;
}

const TOC = [
  ["data", "Data"],
  ["epochs", "Epochs & flipbook"],
  ["motion", "Motion & photometry"],
  ["validation", "Validation against Gaia"],
  ["model", "Model card: mover CNN"],
  ["limits", "Limits"],
] as const;

export default function Methods() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Blink home">
            <Logo />
          </Link>
          <span className="text-[13px] text-fg-faint">/ Methods</span>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/explore?target=wise-0855&fov=6&band=D6" className="rounded-lg px-3 py-1.5 text-[13px] text-fg-muted hover:text-fg">
              Open viewer
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[200px_1fr]">
        <nav className="sticky top-20 hidden h-fit pt-14 lg:block">
          <ul className="space-y-1.5 text-[13px]">
            {TOC.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-fg-muted hover:text-fg">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 max-w-3xl">
          <h1 className="pt-14 text-4xl font-semibold tracking-tight">Methods</h1>
          <P>
            Everything Blink shows is computed from public SPHEREx Level-2 spectral images. This page lists where the data
            come from, what we do to them, how we checked the results, and where they stop being trustworthy.
          </P>

          <H2 id="data">Data</H2>
          <P>
            <b className="text-fg">SPHEREx DR1 + QR3</b> Level-2 spectral image MEFs from NASA/IPAC IRSA (pipeline 7.0.x).
            DR1 covers Surveys 1–2 (reprocessed); QR3 covers Surveys 3–4 and grows weekly. IRSA states that DR1 and QR3
            together supersede QR2, which is no longer searchable, so Blink does not use QR2. Exposures are found with the
            IRSA SIA2 service (collections <code className="num">spherex_dr1</code>, <code className="num">spherex_qr3</code>;
            TAP <code className="num">spherex.plane ⋈ spherex.artifact</code> as a fallback) and fetched as cutouts that keep
            every extension: IMAGE, FLAGS, VARIANCE, ZODI, EPSF and WCS-WAVE. Each detector D1–D6 is covered by a linear
            variable filter, so the wavelength changes across the array; WCS-WAVE gives every pixel’s wavelength.
          </P>
          <P>
            Ancillary: CDS Sesame/SIMBAD (names, proper motions), Gaia DR3 (ESA TAP; validation and vetting), IMCCE SkyBoT
            (known asteroids at the time of each visit), Gagné et al. 2026 SPIFF ultracool-dwarf templates (Zenodo
            10.5281/zenodo.19051216, CC BY 4.0).
          </P>

          <H2 id="epochs">Epochs & flipbook</H2>
          <P>
            For each exposure we subtract the ZODI model, mask pixels flagged TRANSIENT, OVERFLOW, SUR_ERROR, NONFUNC,
            DICHROIC, MISSING_DATA, HOT, COLD, NONLINEAR, PERSIST or OUTLIER, remove a 3σ-clipped residual background, and
            resample onto one north-up tangent-plane grid centred on the target at the native 6.15″ pixel scale (bilinear;
            flags nearest-neighbour). Named targets are centred on their proper-motion-propagated 2026.0 position — the
            challenge coordinate for WISE 0855 is its ~2010 position, about 2′ from where it is now.
          </P>
          <P>
            An <b className="text-fg">epoch</b> is a run of exposures with no gap longer than 7 days (one survey visit, ~3
            weeks as the filter sweeps a field through wavelengths). Within an epoch each detector is co-added with
            inverse-variance weights. “All” is the sum of the six detectors’ S/N maps divided by √6 — a detection image in
            units of σ. Contamination flags (ghosts, streaks, blooms, snowballs, halos, crosstalk) are reported, not masked,
            together with per-exposure aurora, airglow and shuttle-glow flags from the headers.
          </P>
          <P>
            <b className="text-fg">Difference</b> images are formed per detector with a photometric scale factor fitted on
            bright static pixels, divided by the combined noise, summed over detectors and cleaned of large-scale background;
            |Δ| &lt; 1.5σ is shown black. <b className="text-fg">Motion</b> composites put epoch A in blue and B in orange,
            which sum to white, so only things that changed are coloured.
          </P>

          <H2 id="motion">Motion & photometry</H2>
          <P>
            Sources are detected in a deep S/N image (all detectors) and again in a red D4–D6 image, which catches cold
            brown dwarfs that emit almost nothing below 3 µm. In every full epoch each source is fitted in each detector’s
            coadd with that coadd’s mean <b className="text-fg">effective PSF</b> (the EPSF extension: a ×5-oversampled,
            pixel-convolved PSF per detector zone) by Gauss–Newton least squares on unmasked pixels only, so saturated stars
            are measured from their wings. Per-epoch frame offsets are removed using the field stars (all below 0.02 px), and
            a weighted straight line gives the proper motion, with a 0.025 px per-epoch systematic floor and errors scaled
            by √χ²ᵥ.
          </P>
          <P>
            Light curves use forced ePSF photometry at the (moving) source position in every epoch × detector coadd,
            converted to µJy with the pixel solid angle. Saturated cores use relative annulus (“wing”) photometry, which
            tracks variability but is not calibrated.
          </P>

          <MethodsLive />

          <H2 id="limits">Limits</H2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[15px] leading-7 text-fg-muted">
            <li>
              <b className="text-fg">6.2″ pixels.</b> Two sources within ~1 pixel blend; WISE 0855 currently passes over a
              background star, so its centroid-based motion is not reliable this year.
            </li>
            <li>
              <b className="text-fg">Short baseline.</b> DR1 + QR3 span ~1–1.5 years. For bright stars, motions below ~1″/yr
              are not significant; the field-star scatter about Gaia is 0.11–0.17″/yr.
            </li>
            <li>
              <b className="text-fg">Wavelength sampling.</b> Each epoch samples a detector’s band at slightly different
              wavelengths; for steep spectra this alone changes the flux. Short visits are flagged in light curves.
            </li>
            <li>
              <b className="text-fg">Saturation.</b> Barnard’s Star, R Dra and similar are masked at the core in every
              exposure; their astrometry and photometry come from the wings and have larger errors.
            </li>
            <li>
              <b className="text-fg">Synthetic training data.</b> The CNN never saw a real mover during training. Its
              completeness is measured on injections; real-object tests are few.
            </li>
            <li>
              <b className="text-fg">Un-rotated PSF.</b> The ePSF is defined in detector coordinates; we use it on the north-up
              grid without rotating it.
            </li>
            <li>
              <b className="text-fg">Candidates are candidates.</b> Nothing flagged by Blink is a discovery until confirmed
              with independent data.
            </li>
          </ul>
        </main>
      </div>
    </div>
  );
}
