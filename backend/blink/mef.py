"""Read one SPHEREx Level-2 Spectral Image MEF cutout (IMAGE, FLAGS, VARIANCE, ZODI, EPSF, WCS-WAVE).

Follows IRSA spherex-intro / spherex-psf notebooks: spatial WCS from the IMAGE header (with SIP),
per-pixel wavelength from the "W" alternate WCS (SIP disabled) backed by the WCS-WAVE lookup table,
and the ePSF zone nearest the cutout centre on the parent image (via CRPIX1A/CRPIX2A)."""
from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

import numpy as np
from astropy.io import fits
from astropy import log as _alog
from astropy.wcs import WCS, FITSFixedWarning

_alog.setLevel("WARNING")

warnings.simplefilter("ignore", FITSFixedWarning)


@dataclass
class Cutout:
    image: np.ndarray  # MJy/sr, zodi NOT subtracted
    flags: np.ndarray  # int32 bitmask
    variance: np.ndarray  # (MJy/sr)^2
    zodi: np.ndarray  # MJy/sr
    wcs: WCS
    wave_um: np.ndarray  # per-pixel central wavelength (µm)
    bandwidth_um: np.ndarray
    psf: np.ndarray | None  # ePSF (oversampled), normalised to sum 1 per native pixel grid
    psf_oversample: int
    version: str
    header: fits.Header
    flag_names: dict[int, str]
    qa: dict


QA_KEYS = {  # per-exposure quality / contamination keywords from the IMAGE header
    "MJD-AVG": "mjd_avg", "PSF_FWHM": "psf_fwhm_arcsec", "L2DQAFLG": "l2_dqa", "AURORA_CONT": "aurora",
    "SHUTTLE_GLOW_CONT": "shuttle_glow", "HE_AIRGLOW_CONT": "he_airglow", "SATSTRKS": "satellite_streaks",
    "NBLMSRCS": "bloomed_sources", "NSNOWSRC": "snowballs", "PXSRCMSK": "source_pixel_pct",
}


_WCS_PREFIXES = ("CRPIX", "CRVAL", "CTYPE", "CDELT", "CUNIT", "PC1_", "PC2_", "A_", "B_", "AP_", "BP_",
                 "LONPOLE", "LATPOLE", "RADESYS", "WCSAXES", "EQUINOX")


def spatial_wcs(hdr: fits.Header) -> WCS:
    """Spatial WCS (TAN-SIP) built from only the WCS cards — ~50× faster than WCS(full_header)."""
    h = fits.Header()
    for card in hdr.cards:
        k = card.keyword
        if k.startswith(_WCS_PREFIXES) and not k.endswith(("A", "W")) or k in ("A_ORDER", "B_ORDER", "AP_ORDER", "BP_ORDER"):
            h[k] = card.value
    return WCS(h)


def wave_map(hdr: fits.Header, tab, nx: int, ny: int) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel central wavelength and bandwidth (µm) by bilinear interpolation of the WCS-WAVE
    control-point table (FITS Paper III -TAB). Verified identical to astropy's key="W" WCS."""
    from scipy.interpolate import RegularGridInterpolator

    X = np.asarray(tab["X"][0], float)
    Y = np.asarray(tab["Y"][0], float)
    V = np.asarray(tab["VALUES"][0], float)  # (nY, nX, 2)
    px = np.arange(nx) + 1 - hdr["CRPIX1W"] + hdr.get("CRVAL1W", 1)
    py = np.arange(ny) + 1 - hdr["CRPIX2W"] + hdr.get("CRVAL2W", 1)
    yy, xx = np.meshgrid(py, px, indexing="ij")
    pts = np.stack([yy.ravel(), xx.ravel()], -1)
    out = []
    for k in range(2):
        f = RegularGridInterpolator((Y, X), V[..., k], bounds_error=False, fill_value=None)
        out.append(f(pts).reshape(ny, nx).astype(np.float32))
    return out[0], out[1]


def _flag_names(h: fits.Header) -> dict[int, str]:
    out = {}
    for k in h:
        if k.startswith("MSKN"):
            try:
                out[int(k[4:])] = str(h[k])
            except ValueError:
                pass
    return out


def read_cutout(data: bytes, want_psf: bool = True) -> Cutout:
    with fits.open(io.BytesIO(data), memmap=False) as h:
        hdr = h["IMAGE"].header
        img = h["IMAGE"].data.astype(np.float32)
        flags = h["FLAGS"].data.astype(np.int32)
        var = h["VARIANCE"].data.astype(np.float32)
        zodi = h["ZODI"].data.astype(np.float32)
        wcs = spatial_wcs(hdr)
        ny, nx = img.shape
        try:
            wave, band = wave_map(hdr, h["WCS-WAVE"].data, nx, ny)
        except Exception:  # noqa: BLE001
            wave = np.full((ny, nx), np.nan, np.float32)
            band = np.full((ny, nx), np.nan, np.float32)
        psf, ovs = None, 5
        if want_psf and "EPSF" in h:
            tab = h["EPSF"].data
            ph = h["EPSF"].header
            ovs = int(ph.get("OVSMPX", 5))
            xc = 1 + (nx - 1) / 2 - hdr.get("CRPIX1A", 0)
            yc = 1 + (ny - 1) / 2 - hdr.get("CRPIX2A", 0)
            d = (tab["XCENTER"] - xc) ** 2 + (tab["YCENTER"] - yc) ** 2
            psf = np.asarray(tab["EPSF"][int(np.argmin(d))], dtype=np.float32)
        version = str(h[0].header.get("VERSION", ""))
        names = _flag_names(h["FLAGS"].header)
        qa = {}
        for k, v in QA_KEYS.items():
            for src in (hdr, h["FLAGS"].header):
                for key in (k, "L2 " + k):
                    if key in src:
                        val = src[key]
                        if isinstance(val, str) and val.strip() in ("True", "False"):
                            val = val.strip() == "True"
                        qa[v] = val.strip() if isinstance(val, str) else val
                        break
    return Cutout(img, flags, var, zodi, wcs, wave, band, psf, ovs, version, hdr, names, qa)
