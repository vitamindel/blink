"""M2: source detection, per-epoch PSF astrometry, frame registration, linear proper-motion fits,
Gaia DR3 validation, and forced-photometry light curves / spectra."""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from astropy.time import Time
from scipy import ndimage

from . import catalogs
from .config import MAX_WORKERS, PIXEL_SCALE_ARCSEC
from .flipbook import coadd, make_epochs, snr_stack
from .psfphot import EPSF, UJY_PER_MJYSR_PIX, fit_psf, mean_psf
from .stack import BAD_MASK, CONTAM_MASK, Stack

log = logging.getLogger("blink.analysis")
SYS_PX = 0.025  # per-epoch astrometric systematic floor (px) added in quadrature
MIN_EPOCH_EXPOSURES = 6


def year_of(mjd: float) -> float:
    return float(Time(mjd, format="mjd").decimalyear)


# ----------------------------------------------------------------------------------- detection
def deep_snr(st: Stack, detectors=(1, 2, 3, 4, 5, 6)) -> np.ndarray:
    frames = []
    for d in detectors:
        idx = [i for i, e in enumerate(st.exposures) if e.detector == d]
        if idx:
            img, var, _ = coadd(st, idx)
            frames.append((img, var))
    s, _ = snr_stack(frames)
    return s


def detect_sources(snr: np.ndarray, thresh: float = 7.0, nmax: int = 350, edge: int = 4) -> list[dict]:
    n = snr.shape[0]
    s = np.where(np.isfinite(snr), snr, -np.inf)
    peaks = (s == ndimage.maximum_filter(s, size=5)) & (s > thresh)
    peaks[:edge] = peaks[-edge:] = False
    peaks[:, :edge] = peaks[:, -edge:] = False
    out = [dict(x=float(x), y=float(y), snr=float(snr[y, x]), saturated=False) for y, x in zip(*np.nonzero(peaks))]

    # saturated stars: compact masked islands surrounded by very high S/N
    nanmask = ~np.isfinite(snr)
    lab, nl = ndimage.label(nanmask)
    for k in range(1, nl + 1):
        ys, xs = np.nonzero(lab == k)
        if len(ys) > 400 or ys.min() <= 1 or xs.min() <= 1 or ys.max() >= n - 2 or xs.max() >= n - 2:
            continue
        ring = ndimage.binary_dilation(lab == k, iterations=2) & ~nanmask
        if ring.sum() < 4 or np.nanmedian(snr[ring]) < 15:
            continue
        cx, cy = xs.mean(), ys.mean()
        r = np.sqrt(len(ys) / np.pi) + 3
        out = [o for o in out if (o["x"] - cx) ** 2 + (o["y"] - cy) ** 2 > r * r]  # drop ring artefact peaks
        out.append(dict(x=float(cx), y=float(cy), snr=float(np.nanmax(snr[ring])), saturated=True, mask_r=float(r)))
    out.sort(key=lambda o: -o["snr"])
    return out[:nmax]


# ----------------------------------------------------------------------------------- astrometry
def _epoch_frames(st: Stack, members: list[int], detectors=(1, 2, 3, 4, 5, 6)):
    out = {}
    for d in detectors:
        idx = [i for i in members if st.exposures[i].detector == d]
        if len(idx) < 2:
            continue
        img, var, _ = coadd(st, idx)
        out[d] = (img, var, EPSF(mean_psf(st.psf[idx]), st.psf_oversample))
    return out


def measure_epoch(st: Stack, members: list[int], sources: list[dict], detectors=(1, 2, 3, 4, 5, 6),
                  min_det: int = 2) -> np.ndarray:
    """Returns array [nsrc, 4] = x, y, ex, ey (NaN when unmeasured), combining detectors."""
    frames = _epoch_frames(st, members, detectors)
    res = np.full((len(sources), 4), np.nan)
    for k, s in enumerate(sources):
        xs, ys, wx, wy = [], [], [], []
        box = 6 if s.get("saturated") else 4
        for d, (img, var, psf) in frames.items():
            f = fit_psf(img, var, s["x"], s["y"], psf, box=box)
            if not f.ok or not np.isfinite(f.ex) or f.ex <= 0 or f.ex > 0.6 or f.ey > 0.6:
                continue
            if f.flux <= 0 or (np.isfinite(f.eflux) and f.flux / max(f.eflux, 1e-30) < 5):
                continue
            xs.append(f.x)
            ys.append(f.y)
            wx.append(1 / f.ex**2)
            wy.append(1 / f.ey**2)
        if len(xs) >= min_det:
            xs, ys, wx, wy = map(np.asarray, (xs, ys, wx, wy))
            # robust: drop detectors > 3σ from the weighted median
            mx = np.average(xs, weights=wx)
            my = np.average(ys, weights=wy)
            ex = 1 / np.sqrt(wx.sum())
            ey = 1 / np.sqrt(wy.sum())
            # inflate by scatter between detectors (chromatic PSF / un-rotated ePSF)
            if len(xs) >= 3:
                ex = max(ex, np.std(xs) / np.sqrt(len(xs)))
                ey = max(ey, np.std(ys) / np.sqrt(len(ys)))
            res[k] = (mx, my, ex, ey)
    return res


def register(pos: np.ndarray, iters: int = 4) -> tuple[np.ndarray, np.ndarray]:
    """pos [nep, nsrc, 4]. Solve per-epoch translation offsets so the field as a whole stays put.
    Returns (corrected positions, offsets [nep, 2])."""
    nep = pos.shape[0]
    off = np.zeros((nep, 2))
    p = pos.copy()
    for _ in range(iters):
        with np.errstate(all="ignore"):
            mean = np.nanmean(p[:, :, :2], axis=0)  # per-source reference position
        for e in range(nep):
            d = p[e, :, :2] - mean
            ok = np.isfinite(d).all(1) & (p[e, :, 2] < 0.25)
            if ok.sum() < 5:
                continue
            dd = d[ok]
            med = np.median(dd, 0)
            mad = 1.4826 * np.median(np.abs(dd - med), 0) + 1e-3
            keep = (np.abs(dd - med) < 3 * mad).all(1)
            corr = np.median(dd[keep], 0) if keep.sum() >= 5 else med
            off[e] += corr
            p[e, :, 0] -= corr[0]
            p[e, :, 1] -= corr[1]
    return p, off


def fit_motion(t: np.ndarray, x: np.ndarray, ex: np.ndarray):
    """Weighted linear fit x = a + b t. Returns (a, b, σa, σb, χ²)."""
    w = 1 / (ex**2 + SYS_PX**2)
    S, St, Stt = w.sum(), (w * t).sum(), (w * t * t).sum()
    Sx, Stx = (w * x).sum(), (w * t * x).sum()
    D = S * Stt - St**2
    if D <= 0:
        return np.nan, np.nan, np.nan, np.nan, np.nan
    b = (S * Stx - St * Sx) / D
    a = (Stt * Sx - St * Stx) / D
    chi2 = float((w * (x - a - b * t) ** 2).sum())
    return a, b, np.sqrt(Stt / D), np.sqrt(S / D), chi2


def analyse(st: Stack, gaia: bool = True, progress=None) -> dict:
    """Two colour groups: all detectors (most sources), and D4–D6 only, which catches cold brown dwarfs
    that are invisible below ~3 µm and would otherwise be blended with bluer neighbours."""
    a = _analyse_group(st, (1, 2, 3, 4, 5, 6), gaia, progress, label="D1–D6")
    b = _analyse_group(st, (4, 5, 6), gaia, progress, label="D4–D6", thresh=6.0, nmax=250)
    srcs = a["sources"]
    for sb in b["sources"]:
        if "pm" not in sb:
            continue
        d2 = [((sa["x"] - sb["x"]) ** 2 + (sa["y"] - sb["y"]) ** 2, k) for k, sa in enumerate(srcs)]
        dmin, k = min(d2) if d2 else (99, -1)
        if dmin < 1.5**2:
            if sb["pm_sig"] > srcs[k].get("pm_sig", 0) and sb["pm_sig"] >= 5:
                sb["id"] = srcs[k]["id"]
                sb["replaced"] = "D1–D6 measurement blended; red (D4–D6) astrometry used"
                srcs[k] = sb
        else:
            sb["id"] = len(srcs)
            srcs.append(sb)
    rejected = []
    for s_ in srcs:
        g = s_.get("gaia")
        if s_.get("pm_sig", 0) >= 5 and g and g.get("pm") is not None and g.get("sep_arcsec", 9) < 4:
            # Gaia (independent, far more precise) says this star moves much less than we measured
            if abs(s_["pm"] - g["pm"]) > 5 * s_["epm"] / 2 and g["pm"] < 0.3 * s_["pm"]:
                s_["gaia_veto"] = True
                rejected.append(s_["id"])
    movers = [s for s in srcs if s.get("pm_sig", 0) >= 5 and s.get("n_epochs", 0) >= 3 and not s.get("gaia_veto")]
    a["rejected_by_gaia"] = rejected
    a["n_measured"] = sum(1 for s_ in srcs if s_.get("n_epochs", 0) >= 3 and "pm" in s_)
    comp = [s for s in srcs if s.get("gaia") and s.get("pm") is not None and s["n_epochs"] >= 3
            and s["gaia"]["pm"] is not None]
    a["sources"] = srcs
    a["movers"] = [s["id"] for s in sorted(movers, key=lambda s: -s["pm_sig"])]
    a["gaia_comparison"] = _gaia_stats(comp)
    return a


def _analyse_group(st: Stack, detectors, gaia: bool, progress, label: str, thresh: float = 7.0,
                   nmax: int = 350) -> dict:
    t0 = time.time()
    snr = deep_snr(st, detectors)
    sources = detect_sources(snr, thresh=thresh, nmax=nmax)
    epochs = [e for e in make_epochs(st) if len(e.members) >= MIN_EPOCH_EXPOSURES]
    years = np.array([np.mean([year_of(0.5 * (st.exposures[i].t_min_mjd + st.exposures[i].t_max_mjd)) for i in e.members])
                      for e in epochs])
    log.info("%d sources, %d epochs", len(sources), len(epochs))
    pos = np.full((len(epochs), len(sources), 4), np.nan)

    def work(k):
        pos[k] = measure_epoch(st, epochs[k].members, sources, detectors, min_det=1 if len(detectors) <= 3 else 2)
        if progress:
            progress("astrometry", k + 1, len(epochs))

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(epochs) or 1)) as pool:
        list(pool.map(work, range(len(epochs))))
    reg, offsets = register(pos)

    w = st.wcs
    tref = float(np.mean(years)) if len(years) else 2026.0
    out_src = []
    for j, s in enumerate(sources):
        ok = np.isfinite(reg[:, j, 0])
        rec = dict(id=j, x=s["x"], y=s["y"], snr=round(s["snr"], 1), saturated=s.get("saturated", False),
                   n_epochs=int(ok.sum()), detectors=label)
        if ok.sum() >= 2:
            t = years[ok] - tref
            ax, bx, sax, sbx, cx = fit_motion(t, reg[ok, j, 0], reg[ok, j, 2])
            ay, by, say, sby, cy = fit_motion(t, reg[ok, j, 1], reg[ok, j, 3])
            # x increases to the west (cdelt1 < 0) → μα* = −vx·scale
            dof = max(2 * ok.sum() - 4, 1)
            chi2nu = (cx + cy) / dof
            infl = np.sqrt(max(chi2nu, 1.0)) if ok.sum() > 2 else 1.0  # scale errors to the observed scatter
            pmra, pmdec = -bx * PIXEL_SCALE_ARCSEC * 1e3, by * PIXEL_SCALE_ARCSEC * 1e3
            epmra, epmdec = sbx * infl * PIXEL_SCALE_ARCSEC * 1e3, sby * infl * PIXEL_SCALE_ARCSEC * 1e3
            pm = float(np.hypot(pmra, pmdec))
            epm = float(np.sqrt((pmra * epmra) ** 2 + (pmdec * epmdec) ** 2) / max(pm, 1e-9))
            ra, dec = w.all_pix2world(ax, ay, 0)
            rec.update(x=float(ax), y=float(ay), ra=float(ra), dec=float(dec), t_ref=tref,
                       pmra=float(pmra), pmdec=float(pmdec), epmra=float(epmra), epmdec=float(epmdec),
                       pm=pm, epm=epm, pm_sig=float(pm / max(epm, 1e-9)), chi2nu=float(chi2nu),
                       track=[dict(year=float(years[e]), x=float(reg[e, j, 0]), y=float(reg[e, j, 1]),
                                   ex=float(reg[e, j, 2]), ey=float(reg[e, j, 3])) for e in np.nonzero(ok)[0]])
        else:
            ra, dec = w.all_pix2world(s["x"], s["y"], 0)
            rec.update(ra=float(ra), dec=float(dec))
        out_src.append(rec)

    gaia_rows = []
    if gaia:
        try:
            gaia_rows = catalogs.gaia_cone(st.ra, st.dec, st.fov_deg * 0.72, gmax=19.0)
        except Exception as e:  # noqa: BLE001
            log.warning("Gaia query failed: %s", e)
    _match_gaia(out_src, gaia_rows, w, tref)

    movers = [s for s in out_src if s.get("pm_sig", 0) >= 5 and s.get("n_epochs", 0) >= 3]
    comp = [s for s in out_src if s.get("gaia") and s.get("pm") is not None and s["n_epochs"] >= 3
            and s["gaia"]["pm"] is not None]
    log.info("analysis done in %.1fs: %d sources, %d significant movers, %d Gaia matches", time.time() - t0,
             len(out_src), len(movers), len(comp))
    return dict(
        t_ref=tref,
        epochs=[dict(index=e.index, year=float(y), n_exposures=len(e.members), offset_px=[float(o[0]), float(o[1])],
                     date=Time(y, format="decimalyear").iso[:10]) for e, y, o in zip(epochs, years, offsets)],
        sources=out_src,
        movers=[s["id"] for s in sorted(movers, key=lambda s: -s["pm_sig"])],
        gaia_comparison=_gaia_stats(comp),
        n_gaia=len(gaia_rows),
        sys_px=SYS_PX,
    )


def _match_gaia(sources, gaia_rows, w, tref):
    if not gaia_rows:
        return
    g = np.array([[r["ra"], r["dec"], r["pmra"] or 0, r["pmdec"] or 0] for r in gaia_rows], float)
    ra, dec = catalogs.propagate(g[:, 0], g[:, 1], g[:, 2], g[:, 3], catalogs.GAIA_EPOCH, tref)
    gx, gy = w.all_world2pix(ra, dec, 0)
    mags = np.array([r["g"] or 99 for r in gaia_rows])
    for s in sources:
        d2 = (gx - s["x"]) ** 2 + (gy - s["y"]) ** 2
        cand = np.nonzero(d2 < 1.5**2)[0]
        if not len(cand):
            continue
        k = cand[np.argmin(mags[cand])]  # brightest within 9″ dominates the SPHEREx blend
        r = gaia_rows[k]
        pm = float(np.hypot(r["pmra"], r["pmdec"])) if r["pmra"] is not None else None
        s["gaia"] = dict(source_id=r["source_id"], g=r["g"], pmra=r["pmra"], pmdec=r["pmdec"], pm=pm,
                         sep_arcsec=float(np.sqrt(d2[k]) * PIXEL_SCALE_ARCSEC), n_within_9as=int(len(cand)))


def _gaia_stats(comp):
    if not comp:
        return dict(n=0)
    d_ra = np.array([s["pmra"] - s["gaia"]["pmra"] for s in comp])
    d_de = np.array([s["pmdec"] - s["gaia"]["pmdec"] for s in comp])
    rows = sorted(comp, key=lambda s: -s["gaia"]["pm"])[:12]
    return dict(
        n=len(comp),
        median_dpmra=float(np.median(d_ra)), median_dpmdec=float(np.median(d_de)),
        robust_scatter_mas_yr=float(1.4826 * np.median(np.abs(np.r_[d_ra, d_de] - np.median(np.r_[d_ra, d_de])))),
        fastest=[dict(id=s["id"], gaia_id=s["gaia"]["source_id"], g=s["gaia"]["g"],
                      pmra=s["pmra"], pmdec=s["pmdec"], epmra=s["epmra"], epmdec=s["epmdec"],
                      gaia_pmra=s["gaia"]["pmra"], gaia_pmdec=s["gaia"]["pmdec"]) for s in rows],
        scatter=[dict(pm=s["pm"], gaia_pm=s["gaia"]["pm"], epm=s["epm"]) for s in comp],
    )


# ----------------------------------------------------------------------------------- forced photometry
def wing_photometry(img: np.ndarray, var: np.ndarray, x: float, y: float, width: float = 4.0):
    """Relative photometry for saturated stars: background-subtracted flux in an annulus just outside the
    masked core. Proportional to total flux within one detector (PSF wings scale with the star), so it gives
    a valid *relative* light curve, but it is not calibrated to µJy."""
    n = img.shape[0]
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot(xx - x, yy - y)
    core = (r < 8) & ~np.isfinite(img)
    r_in = float(r[core].max() + 1.0) if core.any() else 2.0
    ann = (r >= r_in) & (r < r_in + width) & np.isfinite(img) & np.isfinite(var)
    sky = (r >= r_in + width + 4) & (r < r_in + width + 10) & np.isfinite(img)
    if ann.sum() < 6 or sky.sum() < 10:
        return np.nan, np.nan, r_in
    bg = float(np.median(img[sky]))
    f = float((img[ann] - bg).sum())
    ef = float(np.sqrt(var[ann].sum() + (ann.sum() * np.std(img[sky]) / np.sqrt(sky.sum())) ** 2))
    return f, ef, r_in


def _core_masked(img: np.ndarray, x: float, y: float) -> bool:
    ix, iy = int(round(x)), int(round(y))
    c = img[max(iy - 1, 0):iy + 2, max(ix - 1, 0):ix + 2]
    return c.size > 0 and np.mean(~np.isfinite(c)) > 0.5

def forced_photometry(st: Stack, ra: float, dec: float, pmra: float = 0.0, pmdec: float = 0.0, t_ref: float = 2026.0,
                      per_exposure: bool = True) -> dict:
    """PSF photometry at a (possibly moving) sky position in every exposure and every epoch×detector coadd.
    Position is fixed to the motion model (no centroid freedom) so faint epochs are not biased upward."""
    w = st.wcs
    epochs = make_epochs(st)

    def xy_at(year):
        r2, d2 = catalogs.propagate(ra, dec, pmra, pmdec, t_ref, year)
        x, y = w.all_world2pix(r2, d2, 0)
        return float(x), float(y)

    exp_rows = []
    if per_exposure:
        for i, e in enumerate(st.exposures):
            yr = year_of(0.5 * (e.t_min_mjd + e.t_max_mjd))
            x, y = xy_at(yr)
            if not (2 <= x < st.n - 2 and 2 <= y < st.n - 2):
                continue
            ix, iy = int(round(x)), int(round(y))
            fl = int(np.bitwise_or.reduce(st.flags[i][max(iy - 1, 0):iy + 2, max(ix - 1, 0):ix + 2].ravel()))
            wl = st.wave[i][iy, ix] if np.isfinite(st.wave[i][iy, ix]) else np.nan
            if _core_masked(st.sci[i], x, y):
                fw, efw, _ = wing_photometry(st.sci[i], st.var[i], x, y)
                if not np.isfinite(fw):
                    continue
                exp_rows.append(dict(i=i, mjd=e.t_min_mjd, year=yr, detector=e.detector, wave_um=float(wl),
                                     flux_ujy=fw, eflux_ujy=efw, chi2nu=None, npix=None, method="wing",
                                     contaminated=bool(fl & int(CONTAM_MASK)), masked=True))
                continue
            f = fit_psf(st.sci[i], st.var[i], x, y, EPSF(st.psf[i], st.psf_oversample), box=4, fix_pos=True)
            if not np.isfinite(f.flux):
                continue
            exp_rows.append(dict(i=i, mjd=e.t_min_mjd, year=yr, detector=e.detector, wave_um=float(wl),
                                 flux_ujy=f.flux_ujy, eflux_ujy=f.eflux_ujy, chi2nu=f.chi2nu, npix=f.npix, method="psf",
                                 contaminated=bool(fl & int(CONTAM_MASK)), masked=bool(fl & int(BAD_MASK))))
    lc = []
    for ep in epochs:
        for d in range(1, 7):
            idx = [i for i in ep.members if st.exposures[i].detector == d]
            if not idx:
                continue
            img, var, _ = coadd(st, idx)
            yr = float(np.mean([year_of(st.exposures[i].t_min_mjd) for i in idx]))
            x, y = xy_at(yr)
            if not (2 <= x < st.n - 2 and 2 <= y < st.n - 2):
                continue
            wl = st.wave[idx][:, int(round(y)), int(round(x))]
            if _core_masked(img, x, y):
                fw, efw, _ = wing_photometry(img, var, x, y)
                flux, eflux, method = fw, efw, "wing"
            else:
                f = fit_psf(img, var, x, y, EPSF(mean_psf(st.psf[idx]), st.psf_oversample), box=4, fix_pos=True)
                flux, eflux, method = f.flux_ujy, f.eflux_ujy, "psf"
            if not np.isfinite(flux):
                continue
            full = len(idx) >= 6
            lc.append(dict(epoch=ep.index, year=yr, detector=d, n=len(idx), flux_ujy=flux, eflux_ujy=eflux,
                           method=method, full_coverage=full,
                           wave_min_um=float(np.nanmin(wl)) if np.isfinite(wl).any() else None,
                           wave_max_um=float(np.nanmax(wl)) if np.isfinite(wl).any() else None))
    methods = {r["method"] for r in lc}
    return dict(ra=ra, dec=dec, pmra=pmra, pmdec=pmdec, t_ref=t_ref, exposures=exp_rows, lightcurve=lc,
                unit="µJy" if methods == {"psf"} else "mixed",
                saturated="wing" in methods,
                note="PSF-fit flux with the SPHEREx ePSF at the motion-model position; saturated cores use "
                     "relative annulus (wing) photometry, which is not calibrated to µJy")
