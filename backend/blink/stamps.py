"""Stamp triplets for the mover CNN — shared by training (ml/) and inference (candidates.py).

A stamp is 6×21×21 in S/N units: [A_all, B_all, (B−A)_all, A_red, B_red, (B−A)_red], each channel
median-subtracted. *_all combines D1–D6, *_red combines D4–D6."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .analysis import MIN_EPOCH_EXPOSURES, deep_snr, detect_sources, year_of
from .flipbook import coadd, make_epochs
from .psfphot import EPSF, mean_psf
from .stack import Stack

STAMP = 21


def remove_plane(stamps: np.ndarray, iters: int = 3) -> np.ndarray:
    """Subtract a robust plane a + b·x + c·y from each channel (sources clipped), so large-scale background
    gradients between epochs are not mistaken for change."""
    C, S, _ = stamps.shape
    yy, xx = np.mgrid[0:S, 0:S]
    A = np.stack([np.ones(S * S), (xx.ravel() - S / 2) / S, (yy.ravel() - S / 2) / S], 1)
    out = np.empty_like(stamps)
    for c in range(C):
        v = stamps[c].ravel().astype(np.float64)
        keep = np.ones(v.size, bool)
        coef = np.zeros(3)
        for _ in range(iters):
            coef, *_ = np.linalg.lstsq(A[keep], v[keep], rcond=None)
            r = v - A @ coef
            mad = 1.4826 * np.median(np.abs(r[keep])) + 1e-9
            keep = np.abs(r) < 2.5 * mad
        out[c] = (v - A @ coef).reshape(S, S)
    return out
H = STAMP // 2
RED = (4, 5, 6)
ALL = (1, 2, 3, 4, 5, 6)


@dataclass
class EpochData:
    year: float
    img: dict  # det -> image (MJy/sr)
    var: dict  # det -> variance
    psf: dict  # det -> EPSF


class Field:
    """Per-epoch, per-detector coadds of one field, ready for injection."""

    def __init__(self, st: Stack, exclude_radec: list[tuple[float, float]] | None = None):
        self.st = st
        self.n = st.n
        self.epochs: list[EpochData] = []
        for ep in make_epochs(st):
            if len(ep.members) < MIN_EPOCH_EXPOSURES:
                continue
            img, var, psf = {}, {}, {}
            for d in ALL:
                idx = [i for i in ep.members if st.exposures[i].detector == d]
                if len(idx) < 2:
                    continue
                img[d], var[d], _ = coadd(st, idx)
                psf[d] = EPSF(mean_psf(st.psf[idx]), st.psf_oversample)
            if len(img) >= 4:
                yr = float(np.mean([year_of(st.exposures[i].t_min_mjd) for i in ep.members]))
                self.epochs.append(EpochData(yr, img, var, psf))
        snr = deep_snr(st)
        self.sources = [s for s in detect_sources(snr, thresh=6.0, nmax=400) if not s.get("saturated")]
        self.saturated = [s for s in detect_sources(snr, thresh=6.0, nmax=400) if s.get("saturated")]
        # positions of known real movers / targets: never used as training negatives or injection sites
        self.exclude = []
        for ra, dec in exclude_radec or []:
            x, y = st.wcs.all_world2pix(ra, dec, 0)
            self.exclude.append((float(x), float(y)))
        # distance (px) from every pixel to the nearest excluded position
        yy, xx = np.mgrid[0:self.n, 0:self.n]
        self.dist_ex = np.full((self.n, self.n), 1e9, np.float32)
        for ex, ey in self.exclude:
            self.dist_ex = np.minimum(self.dist_ex, np.hypot(xx - ex, yy - ey).astype(np.float32))
        self._peaks: dict = {}

    def near_excluded(self, x, y, r=6.0):
        ix, iy = int(round(x)), int(round(y))
        if not (0 <= ix < self.n and 0 <= iy < self.n):
            return False
        return bool(self.dist_ex[iy, ix] < r)

    def diff_peaks(self, a: int, b: int, margin: int) -> np.ndarray:
        """Real |B−A| > 4.5σ pixels (artifacts, variables, saturated-star residuals), cached per epoch pair."""
        key = (a, b)
        if key not in self._peaks:
            A, B = self.epochs[a], self.epochs[b]
            dets = [k for k in A.img if k in B.img]
            d = self.snr_combine({k: B.img[k] - A.img[k] for k in dets}, {k: B.var[k] + A.var[k] for k in dets}, dets)
            if d is None:
                self._peaks[key] = np.zeros((0, 2), int)
            else:
                ok = np.abs(d) > 4.5
                ok[:margin] = ok[-margin:] = False
                ok[:, :margin] = ok[:, -margin:] = False
                ok &= self.dist_ex >= 10
                self._peaks[key] = np.argwhere(ok)
        return self._peaks[key]

    # ---------------------------------------------------------------- rendering
    @staticmethod
    def snr_combine(imgs: dict, vars_: dict, dets) -> np.ndarray:
        num = None
        k = None
        for d in dets:
            if d not in imgs:
                continue
            s = imgs[d] / np.sqrt(vars_[d])
            ok = np.isfinite(s)
            num = np.where(ok, s, 0) if num is None else num + np.where(ok, s, 0)
            k = ok.astype(np.float32) if k is None else k + ok
        if num is None:
            return None
        return np.where(k > 0, num / np.sqrt(np.maximum(k, 1)), 0).astype(np.float32)

    def stamp(self, ea: int, eb: int, x: float, y: float, inj_a=None, inj_b=None, strict: bool = False) -> np.ndarray | None:
        """6-channel stamp centred on (x, y). inj_* = {det: image-sized addition} injected first."""
        A, B = self.epochs[ea], self.epochs[eb]
        ix, iy = int(round(x)), int(round(y))
        if ix - H < 0 or iy - H < 0 or ix + H + 1 > self.n or iy + H + 1 > self.n:
            return None
        sl = (slice(iy - H, iy + H + 1), slice(ix - H, ix + H + 1))

        def cut(E, inj):
            imgs = {d: (E.img[d][sl] + (inj[d][sl] if inj and d in inj else 0)) for d in E.img}
            vs = {d: E.var[d][sl] for d in E.var}
            return imgs, vs

        ia, va = cut(A, inj_a)
        ib, vb = cut(B, inj_b)
        chans = []
        for dets in (ALL, RED):
            dets = [d for d in dets if d in ia and d in ib]
            if not dets:
                return None
            a = self.snr_combine(ia, va, dets)
            b = self.snr_combine(ib, vb, dets)
            # difference in S/N units: (B − A) / sqrt(varA + varB), per detector then combined
            dimg = {d: ib[d] - ia[d] for d in dets}
            dvar = {d: va[d] + vb[d] for d in dets}
            dd = self.snr_combine(dimg, dvar, dets)
            chans += [a, b, dd]
        out = np.stack(chans)
        if np.mean(out[0] == 0) > 0.25:  # too much missing data (edge / masked)
            return None
        if strict and max(np.mean(~np.isfinite(out[k]) | (out[k] == 0)) for k in (0, 1, 3, 4)) > 0.10:
            return None  # inference: either epoch only partly covers the stamp (field edges/corners)
        out = np.nan_to_num(out, nan=0.0)
        return remove_plane(out).astype(np.float32)

    def point_source(self, E: EpochData, x: float, y: float, snr_per_det: dict) -> dict:
        """Image-sized additions for a point source at (x, y) with the given S/N in each detector."""
        out = {}
        n = self.n
        x0, x1 = max(int(x) - 5, 0), min(int(x) + 6, n)
        y0, y1 = max(int(y) - 5, 0), min(int(y) + 6, n)
        yy, xx = np.mgrid[y0:y1, x0:x1]
        for d, s in snr_per_det.items():
            if d not in E.img or s <= 0:
                continue
            P = E.psf[d](xx - x, yy - y)
            v = E.var[d][y0:y1, x0:x1]
            ok = np.isfinite(v) & (v > 0)
            if not ok.any():
                continue
            # flux so that the optimal (PSF-weighted) S/N equals s
            info = np.sum(P[ok] ** 2 / v[ok])
            if info <= 0:
                continue
            F = s / np.sqrt(info)
            add = np.zeros((n, n), np.float32)
            add[y0:y1, x0:x1] = F * P
            out[d] = add
        return out


