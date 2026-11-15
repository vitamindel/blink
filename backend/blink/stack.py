"""Reproject every exposure onto one common north-up grid centred on the target.

The result ("stack") is the per-exposure data cube everything else builds on: flipbook coadds,
difference images, source detection, forced-photometry spectra and ML training stamps."""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from astropy.stats import sigma_clipped_stats
from astropy.wcs import WCS

from . import irsa
from .config import BAD_BITS, CONTAM_BITS, FETCH_FOV_DEG, MAX_WORKERS, PIXEL_SCALE_ARCSEC, PRODUCTS, RELEASE_LABEL
from .mef import read_cutout

log = logging.getLogger("blink.stack")
BAD_MASK = np.int32(sum(1 << b for b in BAD_BITS))
CONTAM_MASK = np.int32(sum(1 << b for b in CONTAM_BITS))


def grid_wcs(ra: float, dec: float, fov_deg: float, pixscale_arcsec: float = PIXEL_SCALE_ARCSEC) -> tuple[WCS, int]:
    n = int(np.ceil(fov_deg * 3600 / pixscale_arcsec)) | 1  # odd -> target on a pixel centre
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [ra, dec]
    w.wcs.crpix = [(n + 1) / 2, (n + 1) / 2]
    s = pixscale_arcsec / 3600
    w.wcs.cdelt = [-s, s]
    return w, n


@dataclass
class Stack:
    ra: float
    dec: float
    fov_deg: float
    wcs: WCS
    exposures: list[irsa.Exposure]
    sci: np.ndarray  # [N, n, n] float32, MJy/sr, zodi + local background removed, bad pixels NaN
    var: np.ndarray  # [N, n, n] float32
    flags: np.ndarray  # [N, n, n] int32 (nearest-neighbour resampled)
    wave: np.ndarray  # [N, n, n] float32 um
    psf: np.ndarray  # [N, 33, 33] float32 (ePSF, oversampled)
    psf_oversample: int
    versions: list[str]
    flag_names: dict[int, str] = field(default_factory=dict)
    qa: list[dict] = field(default_factory=list)

    @property
    def n(self):
        return self.sci.shape[1]

    def save(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        meta = dict(ra=self.ra, dec=self.dec, fov_deg=self.fov_deg, wcs=self.wcs.to_header_string(),
                    exposures=[e.to_dict() for e in self.exposures], versions=self.versions,
                    psf_oversample=self.psf_oversample, flag_names=self.flag_names, release=RELEASE_LABEL,
                    qa=self.qa)
        np.savez(path, sci=self.sci, var=self.var, flags=self.flags, wave=self.wave.astype(np.float16),
                 psf=self.psf, meta=np.array(json.dumps(meta)))

    @classmethod
    def load(cls, path: Path) -> "Stack":
        z = np.load(path, allow_pickle=False)
        m = json.loads(str(z["meta"]))
        from astropy.io import fits

        w = WCS(fits.Header.fromstring(m["wcs"]))
        return cls(m["ra"], m["dec"], m["fov_deg"], w, [irsa.Exposure(**e) for e in m["exposures"]],
                   z["sci"], z["var"], z["flags"], z["wave"].astype(np.float32), z["psf"], m["psf_oversample"],
                   m["versions"], {int(k): v for k, v in m["flag_names"].items()}, m.get("qa", []))


_GRID_CACHE: dict = {}


def _grid_world(out_wcs: WCS, n: int):
    key = (out_wcs.to_header_string(), n)
    if key not in _GRID_CACHE:
        yy, xx = np.mgrid[0:n, 0:n]
        _GRID_CACHE.clear()
        _GRID_CACHE[key] = out_wcs.all_pix2world(xx.ravel().astype(float), yy.ravel().astype(float), 0)
    return _GRID_CACHE[key]


def _process_one(data: bytes, out_wcs: WCS, n: int):
    """Resample one exposure onto the common grid. The output->input pixel map is computed once and
    reused for science (bilinear), variance (bilinear), flags (nearest) and wavelength (bilinear)."""
    from scipy.ndimage import map_coordinates

    c = read_cutout(data)
    bad = (c.flags & BAD_MASK) != 0
    sci = c.image - c.zodi
    sci[bad | ~np.isfinite(sci)] = np.nan
    var = c.variance.copy()
    var[bad | ~np.isfinite(var) | (var <= 0)] = np.nan
    ra, dec = _grid_world(out_wcs, n)
    x, y = c.wcs.all_world2pix(ra, dec, 0)
    coords = np.vstack([y, x])
    ny, nx = sci.shape
    inside = (x > -0.5) & (x < nx - 0.5) & (y > -0.5) & (y < ny - 0.5)

    def samp(a, order):
        o = map_coordinates(a, coords, order=order, mode="nearest", prefilter=False)
        o = np.where(inside, o, np.nan)
        return o.reshape(n, n)

    sci_r = samp(sci, 1)  # NaNs propagate to the neighbours: conservative masking
    var_r = samp(var, 1)
    flg_r = samp(c.flags.astype(np.float64), 0)
    wav_r = samp(c.wave_um, 1)
    flg_r = np.where(np.isfinite(flg_r), flg_r, 0).astype(np.int64).astype(np.int32)
    good = np.isfinite(sci_r)
    if good.sum() > 50:
        _, med, _ = sigma_clipped_stats(sci_r[good], sigma=3, maxiters=5)
        sci_r = sci_r - med
    psf = c.psf if c.psf is not None else np.zeros((33, 33), np.float32)
    return (sci_r.astype(np.float32), var_r.astype(np.float32), flg_r, wav_r.astype(np.float32),
            psf.astype(np.float32), c.psf_oversample, c.version, c.flag_names, c.qa)


def build_stack(ra: float, dec: float, fov_deg: float = FETCH_FOV_DEG, fetch_deg: float | None = None,
                progress=None, refresh_search: bool = False) -> Stack:
    t0 = time.time()
    exps = irsa.find_exposures(ra, dec, refresh=refresh_search)
    if not exps:
        raise LookupError("No SPHEREx exposures cover this position (yet).")
    fetch_deg = fetch_deg or round(max(fov_deg, 0.1) * 1.42, 3)  # covers the rotated corners
    raw = irsa.fetch_cutouts(exps, ra, dec, fetch_deg,
                             progress=(lambda i, n: progress("download", i, n)) if progress else None)
    out_wcs, n = grid_wcs(ra, dec, fov_deg)
    _grid_world(out_wcs, n)
    keep = [e for e in exps if raw.get(e.uid)]
    res = [None] * len(keep)
    done = [0]

    def work(i):
        try:
            res[i] = _process_one(raw[keep[i].uid], out_wcs, n)
        except Exception as ex:  # noqa: BLE001
            log.warning("process failed %s: %s", keep[i].uid, ex)
        done[0] += 1
        if progress:
            progress("reproject", done[0], len(keep))

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        list(pool.map(work, range(len(keep))))
    ok = [i for i, r in enumerate(res) if r is not None]
    keep = [keep[i] for i in ok]
    res = [res[i] for i in ok]
    if not res:
        raise LookupError("All SPHEREx cutouts failed to download or parse.")
    names = {}
    for r in res:
        names.update(r[7])
    st = Stack(ra, dec, fov_deg, out_wcs, keep,
               np.stack([r[0] for r in res]), np.stack([r[1] for r in res]), np.stack([r[2] for r in res]),
               np.stack([r[3] for r in res]), np.stack([r[4] for r in res]), res[0][5], [r[6] for r in res], names,
               [r[8] for r in res])
    log.info("stack %d exposures, %dx%d px, built in %.1fs", len(keep), n, n, time.time() - t0)
    return st


def stack_path(slug: str, fov_deg: float) -> Path:
    return PRODUCTS / slug / f"stack_{fov_deg:.3f}.npz"


def get_stack(slug: str, ra: float, dec: float, fov_deg: float = FETCH_FOV_DEG, rebuild: bool = False,
              progress=None, refresh_search: bool = False) -> Stack:
    p = stack_path(slug, fov_deg)
    if p.exists() and not rebuild:
        return Stack.load(p)
    st = build_stack(ra, dec, fov_deg, progress=progress, refresh_search=refresh_search)
    st.save(p)
    return st
