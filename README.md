# Blink

In 1930 Clyde Tombaugh found Pluto by flipping between two photographs with a blink comparator.
Blink rebuilds that for SPHEREx: 102 colours of infrared, every epoch since 2025, and machine learning
that flags what moved and tells you what it is.

NASA Space Apps 2026 — challenge "Planet X and SPHEREx".

## Layout

```
backend/   FastAPI + astropy/reproject/photutils data pipeline (Python 3.11)
ml/        mover CNN: injection training set, training, evaluation, ONNX export
web/       Next.js (App Router) + TypeScript + Tailwind front end
data/      cache/ (IRSA downloads, keyed by URL), products/ (stacks, flipbooks), external/ (templates)
```

## Run it

```bash
python tasks.py setup        # or: make setup   (.venv + pip + pnpm install)
python tasks.py prefetch     # or: make prefetch (downloads + precomputes the 5 challenge targets, ~1 h cold)
python tasks.py api          # backend  → http://localhost:8787
python tasks.py web          # frontend → http://localhost:3100
```

Open `http://localhost:3100/explore?target=wise-0855&fov=12&band=D6`.
Any view is a URL: `/explore?ra=133.7598&dec=-7.2422&fov=6&band=D6` (add `&embed=1` for an iframe-friendly view).
The five challenge targets also ship as static snapshots in `web/public/data/`, so the viewer still works if
IRSA or the backend is down. Any other position is fetched on demand (1–5 min the first time, then cached).

**New data:** QR3 grows weekly — `make refresh` re-queries IRSA and rebuilds. For a new release
(e.g. DR2) edit `COLLECTIONS` / `RELEASE_LABEL` in `backend/blink/config.py` and run `make refresh`.

### API

| endpoint | |
|---|---|
| `GET /api/flipbook?target=wise-0855&fov=6` or `?ra=&dec=&fov=` | 200 + flipbook JSON, or 202 + job while IRSA downloads |
| `GET /api/jobs/{id}` | progress of an on-demand build |
| `GET /api/resolve?q=` | name (CDS Sesame) or coordinates → target with proper motion |
| `GET /api/targets` | the five challenge targets |

## Pipeline (M1)

1. **Search** — SIA2 on `spherex_dr1` + `spherex_qr3` for every Level-2 spectral image whose footprint contains the target.
2. **Cutouts** — `?center=&size=0.284` on each image URL (parallel, 8 workers, retries with backoff, disk cache keyed by URL).
3. **Calibrate** — `IMAGE − ZODI`; pixels with any of TRANSIENT, OVERFLOW, SUR_ERROR, NONFUNC, DICHROIC, MISSING_DATA, HOT, COLD, NONLINEAR, PERSIST, OUTLIER set in `FLAGS` are masked; residual background removed with a 3σ-clipped median.
4. **Align** — every exposure is resampled (bilinear; flags nearest-neighbour) onto one north-up TAN grid centred on the target at the native 6.15″ pixel scale. Per-pixel wavelength comes from the `WCS-WAVE` table.
5. **Epochs** — exposures with no gap > 7 days form one epoch; per detector per epoch an inverse-variance weighted mean is taken. "All" = sum of the six detectors' S/N maps / √6 (a detection image; units of σ).
6. **Flipbook** — frames are sent as float32 and stretched in the browser (asinh / log / linear, contrast, black point), with one set of levels shared by all frames so blinking is honest.

## Motion, difference and light curves (M2)

- **Views:** Flipbook · Stack (inverse-variance sum of the shown epochs) · Difference (B − A, per detector in σ with
  photometric scaling, combined over detectors, large-scale background removed, |Δ| < 1.5σ shown black) ·
  Motion (A in blue, B in orange; the two sum to white, so static stars are neutral and movers split in colour).
- **Sources** are detected in a deep S/N image (all detectors) and again in a red D4–D6 image (cold brown dwarfs).
- **Astrometry:** in every full epoch each source is fitted in each detector's coadd with that coadd's mean
  **ePSF** (Gauss–Newton with analytic gradients, unmasked pixels only, so saturated stars are measured from their
  wings). Detectors are combined by inverse variance; per-epoch frame offsets are removed with the field stars.
- **Proper motion:** weighted linear fit, 0.025 px systematic floor per epoch, errors scaled by √χ²ᵥ.
  "Significant" = ≥ 5σ with ≥ 3 epochs.
- **Validation against Gaia DR3** (ESA TAP, propagated to each epoch): Barnard's Star 10.11 ± 1.53″/yr (Gaia 10.39),
  ε Indi B 5.04 ± 0.39″/yr (Gaia 4.68); field stars scatter 0.11–0.17″/yr about Gaia.
- **Gaia veto:** a ≥5σ mover that Gaia measures as near-static is listed as "rejected by Gaia", not as a mover
  (1 such case in the 5 fields — a step-like position jump near a field edge).
- **Light curves:** forced ePSF photometry at the (moving) source position per epoch × detector (µJy);
  saturated cores use relative annulus ("wing") photometry, labelled as not calibrated.

## Mover CNN (M3)

```bash
python ml/fields.py          # cache extra SPHEREx fields used only as injection backgrounds
python ml/train.py all       # build → train → evaluate → export (ONNX to web/public/models/mover.onnx)
python backend/scripts/candidates.py   # re-score candidates for the five targets
```

- **Input:** 6×21×21 stamp in S/N units — epoch A, epoch B, B−A for D1–D6 and again for D4–D6; each channel
  median-subtracted, then asinh(x/3). Same code (`backend/blink/stamps.py`) for training and inference.
- **Positives:** synthetic movers injected into real per-epoch, per-detector coadds with each coadd's own ePSF
  (S/N 3–60, 0.3–15″/yr, flat / red / blue spectra). **Negatives:** real static sources, empty sky, real
  difference-image peaks, edges of saturated stars, synthetic static variables.
- **Held out:** whole fields (`TEST_FIELDS` in `ml/fields.py`); real movers and Gaia stars > 0.3″/yr are masked from
  training and used only as tests.
- **Inference:** the server scores every candidate (all detected sources + real difference dipoles) with
  onnxruntime; the top 60 ship with their stamps and are re-scored in the browser with onnxruntime-web (WASM files
  in `web/public/ort/`). Metrics land in `data/products/ml_metrics.json` and on the Methods page.
- **Results (v2, held-out GOODS-N + Galactic-plane fields, single stamps):** ROC AUC 0.87, average precision 0.90,
  precision 0.87 / recall 0.67 at 0.5. Real objects never trained on: Barnard's Star 0.99, ε Indi B 1.00,
  WISE 0855 0.97 (the blended case centroiding fails on); R Dra 0.13, RW Aur 0.49 (variables, not movers);
  1.7% of 606 real static Gaia stars score ≥ 0.5.
- **Field candidate lists** use a ±1 px local search (best of 9) and a threshold of **0.9**, calibrated on 628 real
  static Gaia stars (0.6% exceed it). The three real movers rank #1, #1 and #2 in their fields.

## Spectra and "what is it?" (M4)

- Forced ePSF photometry in every exposure, each at its own wavelength (WCS-WAVE), combined into the 102 SPHEREx
  channels (Gagné et al. 2026 bin definitions).
- Template fit with a free scale and a 3% calibration floor: 47 SPIFF brown-dwarf standards (M8–Y1), Planck stars
  (2600–30000 K), power laws (galaxy/QSO-like), plus solar-system objects decided by SkyBoT matches.
- Probabilities from χ² differences tempered by the best fit's reduced χ²; explanation = per-region Δχ² between the
  two leading families (water 1.4/1.9 µm, methane 1.6/3.3 µm, 4.5 µm peak/CO) and classic indices.
- Results: ε Indi B → brown dwarf ~T2 (true: unresolved T1+T6); WISE 0855 → brown dwarf ~T5 (true Y4: beyond the
  library's Y1 and blended at short wavelengths); bright field stars → ~5000 K stars. Saturated stars get no spectrum.

## Decisions log

Decisions made while building, recorded so they can be revisited.

| # | Decision | Why |
|---|----------|-----|
| 1 | **Use SPHEREx DR1 + QR3, not QR2.** Collections `spherex_dr1` + `spherex_qr3` (wide survey). | As of Nov 2026 IRSA says "DR1 and QR3 together supersede QR2"; QR2 is no longer searchable via SIA/TAP (download-only until Feb 2027), QR1 is retired. DR1 = Surveys 1–2 reprocessed; QR3 = Surveys 3–4 with the same pipeline (v7+). Mixing QR2 with DR1/QR3 is discouraged because calibrations changed. |
| 2 | PSF extension is `EPSF` (effective, pixel-convolved PSF; 21×21 zones, 33×33 oversampled ×5), not `PSF`. | Changed in pipeline v7 (DR1/QR3). Zone chosen via `CRPIX1A/2A` per IRSA spherex-psf notebook. |
| 3 | Search: SIA2 primary, TAP (`spherex.artifact ⋈ spherex.plane`) fallback. | During the spike TAP returned 502s while SIA2 worked; both are flaky, so every request retries with backoff. |
| 4 | Named targets are centred at their **proper-motion-propagated 2026.0 position**. | WISE 0855's challenge coordinate (08h55m10.831s −07°14′42.53″) is its ~2010 position; at 8.1″/yr it has moved ~2′ west by 2026. |
| 5 | Epoch = exposures with no gap > 7 days. | Each wide-survey visit spans ~3 weeks (the LVF steps a field through wavelengths), visits repeat every ~6 months. |
| 6 | Zodiacal light (`ZODI`) and a sigma-clipped residual background are subtracted before co-adding. | `IMAGE` is not zodi-subtracted; zodi changes with wavelength across a detector. |
| 7 | Cutouts are fetched at 0.2° (12′) and cropped for smaller fields of view. | Each cutout is ~4 MB regardless of size (the full EPSF table rides along), so bigger cutouts are nearly free. |
| 8 | Brown dwarf templates: Gagné et al. 2026 SPIFF library (Zenodo 10.5281/zenodo.19051216, CC BY 4.0), 47 subtypes M8–Y1. | Built from QR2; used as spectral shape templates only. |
| 9 | Frontend UI primitives are written in the shadcn/ui style (Radix + Tailwind + cva) by hand rather than via the shadcn CLI. | The CLI hung on this Windows machine; the components are the same pattern, owned in `web/src/components/ui`. |
| 10 | Backend on port **8787**, web on **3100**. | Port 8000 was already taken by another local process. |
| 11 | "Short visits" (epochs with < 3 exposures in a detector, or < 6 overall) are hidden by default, toggleable. | They are single-wavelength snapshots and much noisier; showing them by default makes the flipbook flicker for the wrong reason. |
| 12 | Masked pixels are drawn in a distinct dark violet with a legend, not black. | Saturated cores (Barnard's Star, R Dra) otherwise read as "dark holes". |
| 13 | WISE 0855's own motion is not measured by centroiding. | In 2025–26 it passes within ~1 px of a background star; at 6″ pixels the centroid locks onto the blend. It *is* visible in D5/D6 at 8–12σ per epoch and as a dipole in the difference view — the case the M3 CNN (difference triplets) is for. |
| 14 | Light curves are per detector, and short visits are drawn hollow. | Within a detector each epoch can sample different wavelengths (the LVF); for steep spectra that alone mimics variability. |
| 15 | Saturated stars (R Dra, Barnard's Star) use relative wing photometry. | Their cores are masked in every exposure and the ePSF does not reach the wings; relative variability per detector is still valid. |
| 16 | Six-detector charts are small multiples, not six coloured series. | Six categorical colours cannot all stay distinguishable (colour-vision checks); facets can. |
| 17 | Known asteroids come from SkyBoT, queried once per cluster of exposures (≤1 h apart). | An epoch spans weeks and asteroids move ~30″/h; one query per epoch would be meaningless. HTTP 204 = no objects. |
| 18 | The CNN is small (68k parameters) and trained on CPU. | No GPU on the build machine; it has to train in minutes and run in the browser. |
| 19 | Held-out evaluation fields are GOODS-N (sparse) and Plane-1 (crowded Galactic plane). | Whole-field hold-out tests generalisation to unseen sky, not just unseen stamps. |
| 20 | Spectral classes: star / brown dwarf / galaxy-QSO / solar system; stars are blackbodies. | No stellar SPHEREx library was available offline; the caveat is shown in the UI. |
| 21 | v1 → v2 retrain: epoch pairs ≥ 0.35 yr apart, positives must move ≥ 0.35 px, off-centre movers as negatives, S/N up to 400, plane (not median) background per stamp channel. | v1 (AUC 0.71) had unlearnable positives (weeks-apart epochs), learned "a dipole anywhere", never saw bright movers (missed ε Indi B), and flagged background gradients. |
| 22 | Candidate threshold 0.9 instead of 0.5. | The ±1 px local search takes the best of 9 scores; calibrated on real static Gaia stars. |
| 23 | Aladin Lite sky context is opt-in ("Load sky context"). | It pulls 1.8 MB and depends on CDS servers, which were partly unreachable during development. |
