"""PSF photometry / astrometry with SPHEREx effective PSFs (EPSF extension).

The ePSF is a 33×33 grid oversampled ×5 that predicts the pixel response to a point source at any sub-pixel
offset. We fit  model = F · P(x − x0, y − y0) + b  by weighted least squares using only unmasked pixels,
so saturated stars (masked cores) are measured from their wings.

Caveat (documented on the Methods page): the ePSF lives in detector coordinates and our common grid is
north-up, so the PSF is used un-rotated. SPHEREx PSFs are close to round, so this mainly costs a little
precision, not bias."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import map_coordinates

from .config import PIXEL_SCALE_ARCSEC

# (MJy/sr) × pixel  →  µJy :  Ω_pix [sr] × 1e6 (MJy→Jy) × 1e6 (Jy→µJy)
OMEGA_PIX_SR = (PIXEL_SCALE_ARCSEC / 206264.806) ** 2
UJY_PER_MJYSR_PIX = OMEGA_PIX_SR * 1e12


@dataclass
class PsfFit:
    x: float
    y: float
    flux: float  # (MJy/sr)·pix — multiply by UJY_PER_MJYSR_PIX for µJy
    bg: float
    ex: float
    ey: float
    eflux: float
    chi2nu: float
    npix: int
    ok: bool

    @property
    def flux_ujy(self):
        return self.flux * UJY_PER_MJYSR_PIX

    @property
    def eflux_ujy(self):
        return self.eflux * UJY_PER_MJYSR_PIX


class EPSF:
    """Evaluates a (mean) ePSF — and its spatial gradient — at native-pixel offsets."""

    def __init__(self, psf_os: np.ndarray, oversample: int = 5):
        p = np.asarray(psf_os, np.float64)
        if not np.isfinite(p).all() or p.sum() <= 0:
            # fallback: Gaussian with SPHEREx-like FWHM (~1.3 px)
            yy, xx = np.mgrid[-16:17, -16:17] / oversample
            s = 1.3 / 2.355
            p = np.exp(-(xx**2 + yy**2) / (2 * s * s))
        self.p = p / p.sum()
        self.ovs = oversample
        self.c = (p.shape[0] - 1) / 2
        gy, gx = np.gradient(self.p)
        self.gx = gx * oversample  # d/d(native px)
        self.gy = gy * oversample

    def _samp(self, a, dx, dy):
        u = self.c + np.asarray(dx) * self.ovs
        v = self.c + np.asarray(dy) * self.ovs
        return map_coordinates(a, [v.ravel(), u.ravel()], order=1, mode="constant", cval=0.0).reshape(np.shape(dx)) * self.ovs**2

    def __call__(self, dx, dy):
        """Fraction of total flux landing in a native pixel offset (dx, dy) from the source."""
        return self._samp(self.p, dx, dy)

    def grad(self, dx, dy):
        return self._samp(self.gx, dx, dy), self._samp(self.gy, dx, dy)


def mean_psf(psfs: np.ndarray) -> np.ndarray:
    good = [p for p in psfs if np.isfinite(p).all() and p.sum() > 0]
    return np.mean(good, axis=0) if good else np.zeros((33, 33))


def _linear(P, d, w):
    """Weighted LS for d = F·P + b. Returns (F, b, cov)."""
    A = np.stack([P, np.ones_like(P)], 1) * w[:, None]
    AtA = A.T @ A
    cov = np.linalg.inv(AtA)
    F, b = cov @ (A.T @ (d * w))
    return F, b, cov


def fit_psf(img: np.ndarray, var: np.ndarray, x0: float, y0: float, psf: EPSF, box: int = 4,
            fix_pos: bool = False, max_shift: float = 2.5, iters: int = 12) -> PsfFit:
    """Fit one source near (x0, y0) (0-based pixel coords, x = column) by Gauss-Newton with analytic
    ePSF gradients (~1 ms). box = half-size of the stamp. Uses unmasked pixels only."""
    n = img.shape[0]
    ix, iy = int(round(x0)), int(round(y0))
    x_lo, x_hi = max(ix - box, 0), min(ix + box + 1, n)
    y_lo, y_hi = max(iy - box, 0), min(iy + box + 1, n)
    stamp = img[y_lo:y_hi, x_lo:x_hi]
    vstamp = var[y_lo:y_hi, x_lo:x_hi]
    good = np.isfinite(stamp) & np.isfinite(vstamp) & (vstamp > 0)
    bad = PsfFit(x0, y0, np.nan, np.nan, np.nan, np.nan, np.nan, np.nan, int(good.sum()), False)
    if good.sum() < 8:
        return bad
    yy, xx = np.mgrid[y_lo:y_hi, x_lo:x_hi]
    xg, yg, d = xx[good].astype(float), yy[good].astype(float), stamp[good].astype(float)
    w = 1.0 / np.sqrt(vstamp[good].astype(float))
    x, y = float(x0), float(y0)
    try:
        if fix_pos:
            P = psf(xg - x, yg - y)
            if P.max() <= 0:
                return bad
            F, b, cov = _linear(P, d, w)
            r = (F * P + b - d) * w
            chi2nu = float((r**2).sum() / max(len(d) - 2, 1))
            ef = float(np.sqrt(cov[0, 0] * max(chi2nu, 1.0)))
            return PsfFit(x, y, float(F), float(b), 0.0, 0.0, ef, chi2nu, int(good.sum()), True)
        F, b, _ = _linear(psf(xg - x, yg - y), d, w)
        lam = 1e-3
        for _ in range(iters):
            P = psf(xg - x, yg - y)
            Gx, Gy = psf.grad(xg - x, yg - y)
            m = F * P + b
            r = (d - m) * w
            J = np.stack([P, np.ones_like(P), -F * Gx, -F * Gy], 1) * w[:, None]
            JtJ = J.T @ J
            step = np.linalg.solve(JtJ + lam * np.diag(np.diag(JtJ)), J.T @ r)
            dx, dy = np.clip(step[2], -0.5, 0.5), np.clip(step[3], -0.5, 0.5)
            F, b = F + step[0], b + step[1]
            x = float(np.clip(x + dx, x0 - max_shift, x0 + max_shift))
            y = float(np.clip(y + dy, y0 - max_shift, y0 + max_shift))
            if abs(dx) < 1e-3 and abs(dy) < 1e-3:
                break
        P = psf(xg - x, yg - y)
        Gx, Gy = psf.grad(xg - x, yg - y)
        r = (d - F * P - b) * w
        J = np.stack([P, np.ones_like(P), -F * Gx, -F * Gy], 1) * w[:, None]
        dof = max(len(d) - 4, 1)
        chi2nu = float((r**2).sum() / dof)
        cov = np.linalg.inv(J.T @ J) * max(chi2nu, 1.0)
        err = np.sqrt(np.clip(np.diag(cov), 0, None))
    except np.linalg.LinAlgError:
        return bad
    ok = bool(np.isfinite([F, x, y]).all() and abs(x - x0) < max_shift - 1e-3 and abs(y - y0) < max_shift - 1e-3)
    return PsfFit(x, y, float(F), float(b), float(err[2]), float(err[3]), float(err[0]), chi2nu, int(good.sum()), ok)
