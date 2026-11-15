"""Epochs and per-epoch, per-detector inverse-variance coadds (the flipbook frames)."""
from __future__ import annotations

import base64
from dataclasses import dataclass

import numpy as np
from astropy.time import Time

from .config import CONTAM_BITS, DETECTORS, EPOCH_GAP_DAYS, PIXEL_SCALE_ARCSEC, RELEASE_LABEL
from .stack import BAD_MASK, Stack

BANDS = ["D1", "D2", "D3", "D4", "D5", "D6", "all"]


@dataclass
class Epoch:
    index: int
    members: list[int]  # exposure indices into the stack

    def to_dict(self, st: Stack):
        exps = [st.exposures[i] for i in self.members]
        t0, t1 = min(e.t_min_mjd for e in exps), max(e.t_max_mjd for e in exps)
        mid = float(np.mean([0.5 * (e.t_min_mjd + e.t_max_mjd) for e in exps]))
        return dict(index=self.index, mjd_start=t0, mjd_end=t1, mjd_mid=mid,
                    date_start=Time(t0, format="mjd").iso[:10], date_end=Time(t1, format="mjd").iso[:10],
                    date_mid=Time(mid, format="mjd").iso[:10], year_mid=float(Time(mid, format="mjd").decimalyear),
                    n_exposures=len(exps), collections=sorted({e.collection for e in exps}),
                    detectors={f"D{d}": sum(e.detector == d for e in exps) for d in range(1, 7)})


def make_epochs(st: Stack, gap_days: float = EPOCH_GAP_DAYS) -> list[Epoch]:
    order = np.argsort([e.t_min_mjd for e in st.exposures])
    groups, cur, last = [], [], None
    for i in order:
        t = st.exposures[i].t_min_mjd
        if cur and t - last > gap_days:
            groups.append(cur)
            cur = []
        cur.append(int(i))
        last = t
    if cur:
        groups.append(cur)
    return [Epoch(k, g) for k, g in enumerate(groups)]


def coadd(st: Stack, idx: list[int]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Inverse-variance weighted mean of exposures `idx`. Returns (image, variance, n_used per pixel)."""
    if not idx:
        nan = np.full((st.n, st.n), np.nan, np.float32)
        return nan, nan, np.zeros((st.n, st.n), np.int16)
    sci = st.sci[idx]
    var = st.var[idx]
    w = np.where(np.isfinite(sci) & np.isfinite(var) & (var > 0), 1.0 / np.where(var > 0, var, 1), 0.0)
    sw = w.sum(0)
    img = np.where(sw > 0, (np.nan_to_num(sci) * w).sum(0) / np.where(sw > 0, sw, 1), np.nan)
    v = np.where(sw > 0, 1.0 / np.where(sw > 0, sw, 1), np.nan)
    return img.astype(np.float32), v.astype(np.float32), (w > 0).sum(0).astype(np.int16)


def snr_stack(frames: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    """Combine detectors with different units/wavelengths into one detection image: sum of S/N maps / sqrt(k)."""
    num = None
    k = None
    for img, var in frames:
        s = img / np.sqrt(var)
        ok = np.isfinite(s)
        num = np.where(ok, s, 0) if num is None else num + np.where(ok, s, 0)
        k = ok.astype(np.int16) if k is None else k + ok
    if num is None:
        return None, None
    out = np.where(k > 0, num / np.sqrt(np.maximum(k, 1)), np.nan).astype(np.float32)
    return out, np.where(k > 0, 1.0, np.nan).astype(np.float32)


def crop(a: np.ndarray, n_out: int) -> np.ndarray:
    n = a.shape[-1]
    if n_out >= n:
        return a
    o = (n - n_out) // 2
    return a[..., o:o + n_out, o:o + n_out]


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype="<f4").tobytes()).decode()


def contamination(st: Stack, idx: list[int], radius_px: float = 5.0) -> dict:
    """Fraction of exposures in which pixels within `radius_px` of centre carry each flag."""
    c = st.n // 2
    yy, xx = np.mgrid[0:st.n, 0:st.n]
    near = (xx - c) ** 2 + (yy - c) ** 2 <= radius_px**2
    out = {}
    names = {b: st.flag_names.get(b, n) for b, n in CONTAM_BITS.items()}
    for b, name in names.items():
        hit = [(st.flags[i][near] & (1 << b)).any() for i in idx]
        if any(hit):
            out[name] = round(float(np.mean(hit)), 3)
    bad = [float(((st.flags[i][near] & BAD_MASK) != 0).mean()) for i in idx]
    out["masked_pixel_fraction"] = round(float(np.mean(bad)) if bad else 0.0, 3)
    return out


def build_flipbook(st: Stack, fov_deg: float, bands: list[str] = BANDS, gap_days: float = EPOCH_GAP_DAYS) -> dict:
    """Frames per epoch per band, cropped to `fov_deg`. Pixel arrays are base64 little-endian float32."""
    n_out = int(np.ceil(fov_deg * 3600 / PIXEL_SCALE_ARCSEC)) | 1
    n_out = min(n_out, st.n)
    epochs = make_epochs(st, gap_days)
    frames = []
    for ep in epochs:
        per_det = {}
        rec = ep.to_dict(st)
        rec["bands"] = {}
        for d in range(1, 7):
            idx = [i for i in ep.members if st.exposures[i].detector == d]
            if not idx:
                continue
            img, var, nused = coadd(st, idx)
            per_det[d] = (img, var)
            wl = st.wave[idx][:, st.n // 2, st.n // 2]
            wl = wl[np.isfinite(wl)]
            rec["bands"][f"D{d}"] = dict(
                n=len(idx),
                wave_min_um=float(wl.min()) if wl.size else DETECTORS[d][0],
                wave_max_um=float(wl.max()) if wl.size else DETECTORS[d][1],
                contamination=contamination(st, idx),
                **({"data": b64(crop(img, n_out)), "noise": float(np.nanmedian(np.sqrt(crop(var, n_out))))}
                   if f"D{d}" in bands else {}),
            )
        if "all" in bands and per_det:
            s, _ = snr_stack(list(per_det.values()))
            rec["bands"]["all"] = dict(n=len(ep.members), unit="S/N", data=b64(crop(s, n_out)), noise=1.0,
                                       wave_min_um=0.75, wave_max_um=5.0)
        frames.append(rec)
    w = st.wcs.deepcopy()
    off = (st.n - n_out) // 2
    w.wcs.crpix = [w.wcs.crpix[0] - off, w.wcs.crpix[1] - off]
    return dict(
        release=RELEASE_LABEL, ra=st.ra, dec=st.dec, fov_deg=n_out * PIXEL_SCALE_ARCSEC / 3600,
        width=n_out, height=n_out, pixel_scale_arcsec=PIXEL_SCALE_ARCSEC, unit="MJy/sr",
        wcs=dict(crval=list(map(float, w.wcs.crval)), crpix=list(map(float, w.wcs.crpix)),
                 cdelt=list(map(float, w.wcs.cdelt)), ctype=list(w.wcs.ctype)),
        n_exposures=len(st.exposures), versions=sorted(set(st.versions)),
        epochs=frames,
        exposures=[dict(uid=e.uid, obs_id=e.obs_id, detector=e.detector, mjd=e.t_min_mjd,
                        date=Time(e.t_min_mjd, format="mjd").iso[:16], collection=e.collection,
                        wave_um=float(st.wave[i][st.n // 2, st.n // 2]) if np.isfinite(st.wave[i][st.n // 2, st.n // 2]) else None,
                        exptime_s=e.exptime_s, qa=st.qa[i] if i < len(st.qa) else {})
                   for i, e in enumerate(st.exposures)],
    )
