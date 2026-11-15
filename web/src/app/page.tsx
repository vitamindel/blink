import { ArrowRight } from "lucide-react";
import { Figtree } from "next/font/google";
import Link from "next/link";
import { HeroBlink } from "@/components/hero-blink";
import { HeroSearch } from "@/components/hero-search";
import { ResourceLinks } from "@/components/home/resource-links";
import { ScoreChart } from "@/components/home/score-chart";
import { RevealObserver, StoryTrack } from "@/components/home/scroll";
import { SpectrumChart } from "@/components/home/spectrum-chart";
import { StarField } from "@/components/home/star-field";
import { TEST_TARGETS } from "@/lib/api";
import { LINKS } from "@/lib/links";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-home", display: "swap" });

const VIEWER = "/explore?target=eps-indi-b&fov=6&band=D3&view=motion";

const STATS = [
  ["1,942", "SPHEREx exposures of the five challenge targets"],
  ["10.1″/yr", "Barnard’s Star as Blink measures it, against 10.4″/yr from Gaia"],
  ["0.87", "MoverNet’s ROC AUC on two patches of sky it never trained on"],
  ["102", "colours between 0.75 and 5 µm, everywhere on the sky"],
] as const;

/** Two dots, one object seen at two epochs, inside a ring. */
function Mark() {
  return (
    <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden className="drop-shadow-[0_0_6px_rgba(173,220,255,0.55)]">
      <circle cx="11" cy="11" r="9.5" fill="none" stroke="currentColor" strokeOpacity=".45" />
      <circle cx="8" cy="12.5" r="2.4" fill="#3b8fe6" />
      <circle cx="14" cy="9.5" r="2.4" fill="#e5661f" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className={`dark home ${figtree.variable}`}>
      <StarField />
      <RevealObserver />

      <header className="home-bar">
        <Link className="home-mark" href="/" aria-label="Blink home">
          <Mark />
          <span>Blink</span>
        </Link>
        <nav className="home-nav" aria-label="Sections">
          <Link href={VIEWER}>Explore</Link>
          <Link className="wide" href="/methods">
            Methods
          </Link>
          {LINKS.paper && (
            <a href={LINKS.paper} target="_blank" rel="noopener noreferrer">
              Paper
            </a>
          )}
        </nav>
      </header>

      <main>
        <section className="home-hero" aria-label="Blink">
          <div className="flex flex-col items-center">
            <p className="home-pill reveal" style={{ transitionDelay: "0.2s" }}>
              <span className="size-1.5 rounded-full bg-[var(--h-blue)] shadow-[0_0_8px_var(--h-blue)]" />
              NASA Space Apps 2026
            </p>
            <h1 className="home-word reveal" style={{ transitionDelay: "0.36s" }}>
              Blink
            </h1>
            <p className="home-lede reveal" style={{ transitionDelay: "0.52s" }}>
              Find what moved in SPHEREx
            </p>
            <div className="reveal mt-10 flex flex-wrap justify-center gap-2.5" style={{ transitionDelay: "0.68s" }}>
              <Link className="home-btn primary" href={VIEWER}>
                Open the viewer <ArrowRight className="size-4" aria-hidden />
              </Link>
              <ResourceLinks />
            </div>
          </div>
          <a className="home-cue reveal" href="#story" aria-label="Scroll down" style={{ transitionDelay: "1s" }}>
            <span />
          </a>
        </section>

        <StoryTrack
          id="story"
          legend={
            <>
              <span>
                <i style={{ background: "#3b8fe6" }} />
                First visit
              </span>
              <span>
                <i style={{ background: "#e5661f" }} />
                Six months later
              </span>
            </>
          }
          lines={[
            {
              show: [0.1, 0.36],
              text: "In 1930 Clyde Tombaugh found Pluto by flicking back and forth between two photos of the same stars.",
            },
            {
              show: [0.4, 0.66],
              text: "SPHEREx photographs the entire sky every six months, in 102 colours of infrared.",
            },
            {
              show: [0.7, 1.5],
              text: (
                <>
                  Blink flicks between those snapshots{" "}
                  <span className="text-[var(--h-ink-2)]">and looks for anything that moved.</span>
                </>
              ),
            },
          ]}
        />

        <div id="panels">
          <section className="home-stats" aria-label="Results">
            {STATS.map(([n, l], i) => (
              <div key={n} className="reveal" style={{ transitionDelay: `${i * 0.1}s` }}>
                <div className="num">{n}</div>
                <p>{l}</p>
              </div>
            ))}
          </section>

          <section className="home-panel" aria-labelledby="h-blink">
            <div className="home-copy">
              <p className="home-kicker reveal">01 · Blink</p>
              <h2 id="h-blink" className="reveal">
                Every visit, lined up
              </h2>
              <p className="reveal">
                Blink grabs every SPHEREx image of your patch of sky from NASA’s archive, cleans out bad pixels and the
                glow of zodiacal dust, and stacks each visit onto the same grid. After that you can flick between visits
                the way Tombaugh flicked between photo plates.
              </p>
              <p className="reveal">
                The image here is real. It’s WISE 0855−0714, the coldest brown dwarf anyone has found, creeping across
                the field at about 8 arcseconds a year.
              </p>
            </div>
            <figure className="home-figure reveal">
              <HeroBlink />
            </figure>
          </section>

          <section className="home-panel flip" aria-labelledby="h-colour">
            <div className="home-copy">
              <p className="home-kicker reveal">02 · Spectra</p>
              <h2 id="h-colour" className="reveal">
                102 colours of infrared
              </h2>
              <p className="reveal">
                SPHEREx has a useful quirk. Each pixel sees a slightly different wavelength, so a star gets measured in
                a new colour every time the telescope passes over it. Blink follows a moving object through all of those
                exposures and stitches them into one spectrum from 0.75 to 5 µm.
              </p>
              <p className="reveal">
                Do that for ε Indi B and the water and methane dips land right where a cool T dwarf should have them. No
                star template comes close.
              </p>
            </div>
            <figure className="home-figure home-card reveal">
              <SpectrumChart />
            </figure>
          </section>

          <section className="home-panel" aria-labelledby="h-ml">
            <div className="home-copy">
              <p className="home-kicker reveal">03 · Machine learning</p>
              <h2 id="h-ml" className="reveal">
                Taught to spot motion
              </h2>
              <p className="reveal">
                MoverNet is a small neural network, small enough to run right in your browser. We trained it on fake
                moving stars planted in real SPHEREx images, along with plenty of stars that flicker but stay put, so it
                wouldn’t mix the two up.
              </p>
              <p className="reveal">
                It never saw any of these five objects in training. The three that really move score close to 1, and both
                variable stars stay under the cutoff (RW Aurigae only just).
              </p>
            </div>
            <figure className="home-figure home-card reveal">
              <ScoreChart />
            </figure>
          </section>

          <section className="home-panel flip" aria-labelledby="h-explore">
            <div className="home-copy">
              <p className="home-kicker reveal">04 · Explore</p>
              <h2 id="h-explore" className="reveal">
                Point it at any patch of sky
              </h2>
              <p className="reveal">
                Type in a star’s name or a pair of coordinates and Blink builds the flipbook for you. If you just want to
                look around, the five challenge targets are ready to go.
              </p>
              <div className="reveal mt-7 max-w-[460px]">
                <HeroSearch />
              </div>
            </div>
            <figure className="home-figure reveal">
              <ul className="home-targets">
                {TEST_TARGETS.map((t) => (
                  <li key={t.slug}>
                    <Link href={`/explore?target=${t.slug}&fov=6&band=${t.slug === "wise-0855" ? "D6" : "all"}`}>
                      <div className="min-w-0">
                        <div className="text-[16px] font-medium text-white">{t.name}</div>
                        <div className="truncate text-[13px] text-[var(--h-ink-3)]">{t.blurb}</div>
                      </div>
                      <span className="kind">{t.kind}</span>
                      <ArrowRight className="arrow size-4" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </figure>
          </section>
        </div>

        <section className="home-work" id="work" aria-labelledby="h-work">
          <h2 id="h-work" className="reveal">
            Read the work.
          </h2>
          <p className="reveal max-w-[52ch] text-[17px] text-[var(--h-ink-2)]">
            The paper walks through how Blink works and how well it holds up against Gaia. It’s also honest about what
            still breaks.
          </p>
          <div className="reveal flex flex-wrap justify-center gap-3">
            <ResourceLinks large />
          </div>
          <div className="reveal flex flex-wrap justify-center gap-3">
            <Link className="home-btn" href={VIEWER}>
              Open the viewer <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link className="home-btn" href="/methods">
              Methods
            </Link>
          </div>
        </section>
      </main>

      <footer className="home-foot">
        <p>Made for NASA Space Apps 2026</p>
        <p>
          Data from SPHEREx DR1 + QR3 (NASA/JPL-Caltech, IRSA), Gaia DR3 (ESA), SIMBAD (CDS), SkyBoT (IMCCE) and the
          SPIFF templates of Gagné et al. (2026)
        </p>
      </footer>
    </div>
  );
}
