"""M4: SPHEREx spectra on the fly and "what is it?".

Spectrum: forced ePSF photometry in every exposure (each at its own wavelength from WCS-WAVE), combined into the
102 SPHEREx channels (Gagné et al. 2026 bin definitions) by inverse-variance weighting.

Classification by template fitting (free scale, χ²):
  brown dwarf  — Gagné et al. 2026 SPIFF SPHEREx standards, 47 subtypes M8–Y1 (incl. young / subdwarf variants)
  star         — Planck spectra 2600–30000 K (adequate at 0.75–5 µm, coarse for M dwarfs' water bands)
  galaxy / QSO — power laws f_ν ∝ λ^β (hot dust / AGN-like) — SPHEREx alone cannot separate galaxies from stars
                 by SED at this resolution, so this family is deliberately simple
  solar system — decided by motion: a SkyBoT asteroid at the position, or motion far too fast for a star
Explanation: which wavelength regions drive the decision (per-region Δχ² between the best fits of the two
leading families) plus classic spectral indices (water, methane, 4.5 µm peak)."""
from __future__ import annotations

import csv
from functools import lru_cache
from pathlib import Path

import numpy as np

from .config import EXTERNAL

GAGNE = EXTERNAL / "gagne2026"
C_UM_S = 2.99792458e14  # µm/s
SYS_FRAC = 0.03  # calibration floor added in quadrature

REGIONS = [  # (lo, hi, label, physics)
    (0.75, 1.10, "0.75–1.1 µm", "optical/Y-band continuum"),
    (1.10, 1.30, "1.1–1.3 µm", "J-band peak"),
    (1.30, 1.50, "1.3–1.5 µm", "water absorption (1.4 µm)"),
    (1.50, 1.80, "1.5–1.8 µm", "H band; methane at 1.6 µm"),
    (1.80, 2.05, "1.8–2.05 µm", "water absorption (1.9 µm)"),
    (2.05, 2.50, "2.05–2.5 µm", "K band; methane 2.2 µm / H₂ CIA"),
    (2.50, 3.10, "2.5–3.1 µm", "water (2.7 µm)"),
    (3.10, 3.70, "3.1–3.7 µm", "methane fundamental (3.3 µm)"),
    (3.70, 4.20, "3.7–4.2 µm", "L′ continuum"),
    (4.20, 5.00, "4.2–5.0 µm", "4.5 µm peak / CO (4.6 µm)"),
]


@lru_cache(maxsize=1)
def spherex_bins() -> tuple[np.ndarray, np.ndarray]:
    rows = list(csv.DictReader(open(GAGNE / "spherex_bins.csv")))
    return (np.array([float(r["wavelength_center_um"]) for r in rows]),
            np.array([float(r["wavelength_width_um"]) for r in rows]))


@lru_cache(maxsize=1)
def bd_templates() -> dict[str, tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """name -> (λ µm, F_λ, σ) from the SPIFF hybrid standards."""
    out = {}
    d = GAGNE / "hybrid" / "spiff_templates" / "hybrid_csv"
    for p in sorted(d.glob("*_spherex_standard.csv")):
        name = p.name.replace("_spherex_standard.csv", "").replace("d_", "").strip()
        rows = [[float(v) for v in line.split(",")] for line in p.read_text().splitlines()[1:] if line.strip()]
        a = np.array(rows)
        out[name] = (a[:, 0], a[:, 1], a[:, 2])
    return out


def _planck_flam(lam_um: np.ndarray, T: float) -> np.ndarray:
    lam = lam_um * 1e-6
    x = 1.438776877e-2 / (lam * T)
    return 1 / lam**5 / np.expm1(np.clip(x, 1e-6, 700))


STAR_T = [2600, 2900, 3200, 3600, 4200, 5000, 6000, 7500, 10000, 15000, 30000]
PL_BETA = [-1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5]


def bin_spectrum(rows: list[dict]) -> list[dict]:
    """Per-exposure photometry -> 102 channels. rows need wave_um, flux_ujy, eflux_ujy (+ masked/contaminated)."""
    centers, widths = spherex_bins()
    lam = np.array([r["wave_um"] for r in rows], float)
    f = np.array([r["flux_ujy"] for r in rows], float)
    e = np.array([r["eflux_ujy"] for r in rows], float)
    good = np.isfinite(lam) & np.isfinite(f) & np.isfinite(e) & (e > 0)
    good &= np.array([not r.get("masked") and r.get("method", "psf") == "psf" for r in rows])
    out = []
    for c, w in zip(centers, widths):
        sel = good & (np.abs(lam - c) <= w / 2)
        if sel.sum() == 0:
            continue
        wt = 1 / e[sel] ** 2
        fm = float((f[sel] * wt).sum() / wt.sum())
        em = float(1 / np.sqrt(wt.sum()))
        if sel.sum() >= 3:  # inflate by scatter between exposures (variability, systematics)
            em = max(em, float(np.std(f[sel]) / np.sqrt(sel.sum())))
        out.append(dict(wave_um=float(c), width_um=float(w), flux_ujy=fm, eflux_ujy=em, n=int(sel.sum())))
    return out


def _fit(lam, flam, sig, tl, tf, ts=None):
    """Scale template (tl, tf) to data; returns (chi2, scale, model, per-point chi2) on the overlap."""
    ok = (lam >= tl.min()) & (lam <= tl.max())
    if ok.sum() < 8:
        return np.inf, np.nan, None, None
    t = np.interp(lam[ok], tl, tf)
    s2 = sig[ok] ** 2 + (SYS_FRAC * np.abs(flam[ok])) ** 2
    if ts is not None:
        tsig = np.interp(lam[ok], tl, ts)
    w = 1 / s2
    a = float((w * flam[ok] * t).sum() / max((w * t * t).sum(), 1e-300))
    if ts is not None:
        s2 = s2 + (a * tsig) ** 2
        w = 1 / s2
    r2 = (flam[ok] - a * t) ** 2 * w
    model = np.full_like(lam, np.nan)
    model[ok] = a * t
    per = np.full_like(lam, np.nan)
    per[ok] = r2
    return float(r2.sum()) / ok.sum() * len(lam), a, model, per  # normalise to full length for fair comparison


def _index(lam, fnu, lo, hi):
    sel = (lam >= lo) & (lam < hi)
    return float(np.median(fnu[sel])) if sel.sum() else np.nan


def classify(spec: list[dict], moving_fast: bool = False, skybot_match: str | None = None) -> dict:
    if len(spec) < 10:
        return dict(label="insufficient data", family=None, n_channels=len(spec))
    lam = np.array([s["wave_um"] for s in spec])
    fnu = np.array([s["flux_ujy"] for s in spec])
    efnu = np.array([s["eflux_ujy"] for s in spec])
    flam = fnu * C_UM_S / lam**2 * 1e-12  # arbitrary units
    sig = efnu * C_UM_S / lam**2 * 1e-12

    fits = {}
    for name, (tl, tf, ts) in bd_templates().items():
        chi2, a, model, per = _fit(lam, flam, sig, tl, tf, ts)
        fits[("brown_dwarf", name)] = (chi2, a, model, per)
    grid = np.linspace(0.7, 5.1, 300)
    for T in STAR_T:
        fits[("star", f"{T} K")] = _fit(lam, flam, sig, grid, _planck_flam(grid, T))
    for b in PL_BETA:
        fits[("galaxy_qso", f"β={b:+.1f}")] = _fit(lam, flam, sig, grid, grid ** (b - 2.0))

    best = {}
    for (fam, name), v in fits.items():
        if np.isfinite(v[0]) and (fam not in best or v[0] < best[fam][1][0]):
            best[fam] = (name, v)
    dof = max(len(lam) - 1, 1)
    chis = {fam: v[1][0] for fam, v in best.items()}
    cmin = min(chis.values())
    # temper with the best reduced χ² so a poor-but-best fit does not look overconfident
    temp = max(cmin / dof, 1.0)
    lik = {fam: np.exp(-(c - cmin) / (2 * temp)) for fam, c in chis.items()}
    z = sum(lik.values())
    probs = {fam: float(v / z) for fam, v in lik.items()}

    fam_best = max(probs, key=probs.get)
    if skybot_match:
        fam_best = "solar_system"
        probs = {**{k: v * 0.05 for k, v in probs.items()}, "solar_system": 0.95}
    elif moving_fast:
        probs = {**probs}
    name_best = best[fam_best][0] if fam_best in best else skybot_match

    # explanation: per-region Δχ² between the two best families
    order = sorted((f for f in best), key=lambda f: chis[f])
    regions = []
    if len(order) >= 2:
        fa, fb = order[0], order[1]
        pa, pb = best[fa][1][3], best[fb][1][3]
        for lo, hi, label, phys in REGIONS:
            sel = (lam >= lo) & (lam < hi) & np.isfinite(pa) & np.isfinite(pb)
            if sel.sum() == 0:
                continue
            d = float(pb[sel].sum() - pa[sel].sum())
            regions.append(dict(region=label, physics=phys, delta_chi2=d, favours=fa if d > 0 else fb, n=int(sel.sum())))
        regions.sort(key=lambda r: -abs(r["delta_chi2"]))

    idx = dict(
        water_1p4=_index(lam, fnu, 1.33, 1.47) / _index(lam, fnu, 1.18, 1.30),
        methane_1p6=_index(lam, fnu, 1.60, 1.72) / _index(lam, fnu, 1.50, 1.58),
        methane_3p3=_index(lam, fnu, 3.20, 3.45) / np.nanmean([_index(lam, fnu, 2.90, 3.10), _index(lam, fnu, 3.80, 4.00)]),
        peak_4p5_over_1p25=_index(lam, fnu, 4.35, 4.75) / _index(lam, fnu, 1.18, 1.32),
    )
    idx = {k: (None if not np.isfinite(v) else float(v)) for k, v in idx.items()}

    def model_curve(fam):
        if fam not in best:
            return None
        m = best[fam][1][2]
        # back to f_ν (µJy) for plotting on the data's scale
        return [None if not np.isfinite(v) else float(v / (C_UM_S / l**2 * 1e-12)) for v, l in zip(m, lam)]

    label = {
        "brown_dwarf": f"brown dwarf candidate, ~{name_best}",
        "star": f"star (T≈{name_best})",
        "galaxy_qso": f"galaxy / QSO-like continuum ({name_best})",
        "solar_system": f"solar-system object ({name_best})",
    }.get(fam_best, fam_best)
    bd_rank = sorted(((n, v[0]) for (f, n), v in fits.items() if f == "brown_dwarf" and np.isfinite(v[0])), key=lambda x: x[1])[:5]
    return dict(
        label=label, family=fam_best, best=name_best, probabilities=probs,
        reduced_chi2={f: float(c / dof) for f, c in chis.items()},
        best_templates={f: best[f][0] for f in best},
        top_brown_dwarf_types=[dict(type=n, reduced_chi2=float(c / dof)) for n, c in bd_rank],
        regions=regions[:6], indices=idx,
        models={f: model_curve(f) for f in best},
        n_channels=int(len(lam)),
        caveats=_caveats(lam, fam_best, cmin / dof),
    )


def _caveats(lam, fam, rchi2):
    c = []
    if lam.min() > 1.0:
        c.append("No data below 1 µm in this spectrum.")
    if rchi2 > 5:
        c.append(f"Best fit is poor (reduced χ² {rchi2:.1f}): blend, variability or an object type not in the library.")
    if fam == "star":
        c.append("Stars are modelled as blackbodies; M dwarfs' water bands are not captured, so cool stars can fit late-M/L templates.")
    if fam == "galaxy_qso":
        c.append("SPHEREx resolution cannot separate galaxies from stars by SED alone; this family is a simple power law.")
    return c
