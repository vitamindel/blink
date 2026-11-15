"""M3 inference: find mover candidates in a field and score them with the CNN (ONNX).

Candidates = every detected source (stamp centred on its motion-model midpoint) + real difference-image dipoles
(a positive and a negative |B−A| peak within a few pixels). Each gets a 6×21×21 stamp for the epoch pair with the
best motion S/N. The server scores them with onnxruntime; the top candidates are shipped with their stamps so the
browser can re-run the same model with onnxruntime-web."""
from __future__ import annotations

import base64
import logging
from pathlib import Path

import numpy as np
from scipy import ndimage

from .catalogs import propagate
from .config import PIXEL_SCALE_ARCSEC, ROOT
from .stack import Stack
from .stamps import ALL, Field

log = logging.getLogger("blink.candidates")
MODEL_PATH = ROOT / "ml" / "models" / "mover.onnx"
# Flagging threshold for field candidates. The local ±1 px search takes the best of 9 scores, which inflates
# false positives relative to the single-stamp model card (threshold 0.5); 0.9 was calibrated on real static
# Gaia stars in the five challenge fields (0.6% exceed it).
FIELD_THRESHOLD = 0.9
_session = None


def model_available() -> bool:
    return MODEL_PATH.exists()


def _sess():
    global _session
    if _session is None:
        import onnxruntime as ort

        _session = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    return _session


def preprocess(X: np.ndarray) -> np.ndarray:
    return np.arcsinh(X / 3.0).astype(np.float32)  # must match ml/train.py


def score(X: np.ndarray) -> np.ndarray:
    if not len(X):
        return np.zeros(0)
    logit = _sess().run(None, {"stamps": preprocess(X)})[0].ravel()
    return 1 / (1 + np.exp(-logit))


def best_pair(field: Field) -> tuple[int, int]:
    """Epoch pair maximising baseline × √(harmonic mean of exposure counts)."""
    best, pa, pb = -1.0, 0, len(field.epochs) - 1
    for i in range(len(field.epochs)):
        for j in range(i + 1, len(field.epochs)):
            # S/N of the pair ~ sqrt of summed inverse noise; weight by baseline (motion signal)
            inv = [float(np.nanmedian(1 / np.sqrt(field.epochs[k].var[d]))) for k in (i, j) for d in field.epochs[k].var]
            s = (field.epochs[j].year - field.epochs[i].year) * float(np.mean(inv))
            if s > best:
                best, pa, pb = s, i, j
    return pa, pb


def find_candidates(st: Stack, analysis: dict | None, max_ship: int = 60) -> dict:
    field = Field(st)
    if len(field.epochs) < 2:
        return dict(pair=None, candidates=[], model=model_available())
    a, b = best_pair(field)
    ya, yb = field.epochs[a].year, field.epochs[b].year
    w = st.wcs
    cands = []

    # (1) every detected source, centred on its motion-model midpoint between the two epochs
    for s in (analysis or {}).get("sources", []):
        pmra = s.get("pmra", 0.0) if s.get("pm_sig", 0) >= 3 else 0.0
        pmdec = s.get("pmdec", 0.0) if s.get("pm_sig", 0) >= 3 else 0.0
        tref = s.get("t_ref", 2026.0)
        r0, d0 = propagate(s["ra"], s["dec"], pmra, pmdec, tref, ya)
        r1, d1 = propagate(s["ra"], s["dec"], pmra, pmdec, tref, yb)
        x0, y0 = w.all_world2pix(r0, d0, 0)
        x1, y1 = w.all_world2pix(r1, d1, 0)
        cands.append(dict(kind="source", source_id=s["id"], x=(float(x0) + float(x1)) / 2, y=(float(y0) + float(y1)) / 2,
                          snr=s.get("snr"), pm=s.get("pm"), epm=s.get("epm"), pm_sig=s.get("pm_sig"),
                          gaia_pm=(s.get("gaia") or {}).get("pm")))

    # (2) real difference-image dipoles not already covered by a source
    A, B = field.epochs[a], field.epochs[b]
    dets = [k for k in A.img if k in B.img]
    d = field.snr_combine({k: B.img[k] - A.img[k] for k in dets}, {k: B.var[k] + A.var[k] for k in dets}, dets)
    if d is not None:
        d = np.nan_to_num(d)
        pos = (d == ndimage.maximum_filter(d, 5)) & (d > 4)
        neg = (d == ndimage.minimum_filter(d, 5)) & (d < -4)
        P = np.argwhere(pos)
        N = np.argwhere(neg)
        for py, px in P:
            if len(N) == 0:
                break
            dist = np.hypot(N[:, 0] - py, N[:, 1] - px)
            k = int(np.argmin(dist))
            if 0.7 <= dist[k] <= 4.5:
                ny, nx = N[k]
                mx, my = (px + nx) / 2, (py + ny) / 2
                # keep dipoles even next to a catalogued source: a mover passing a static star (WISE 0855 in
                # 2025-26) is centred on the dipole, not on the blended centroid
                if all((c["x"] - mx) ** 2 + (c["y"] - my) ** 2 > 1.0 for c in cands):
                    cands.append(dict(kind="dipole", x=float(mx), y=float(my), snr=float(d[py, px]),
                                      sep_px=float(dist[k])))

    # local search: score each candidate on a 3×3 grid of ±1 px offsets and keep the best position. A mover's
    # stamp should be centred on its track midpoint, which a blended or static-fit centroid can miss by ~1 px.
    offsets = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    X, owner, pos = [], [], []
    for k, c in enumerate(cands):
        for dx, dy in offsets:
            s_ = field.stamp(a, b, c["x"] + dx, c["y"] + dy, strict=True)
            if s_ is not None:
                X.append(s_)
                owner.append(k)
                pos.append((c["x"] + dx, c["y"] + dy))
    X = np.stack(X) if X else np.zeros((0, 6, 21, 21), np.float32)
    have_model = model_available()
    allsc = score(X) if have_model else np.zeros(len(X))
    best: dict[int, int] = {}
    for i, k in enumerate(owner):
        if k not in best or allsc[i] > allsc[best[k]]:
            best[k] = i
    keep, scores, stamps_ = [], [], []
    for k, i in best.items():
        c = cands[k]
        c["x"], c["y"] = pos[i]
        keep.append(c)
        scores.append(allsc[i])
        stamps_.append(X[i])
    X = stamps_
    for c, sc, xs in zip(keep, scores, X):
        c["score"] = float(sc)
        ra, dec = w.all_pix2world(c["x"], c["y"], 0)
        c["ra"], c["dec"] = float(ra), float(dec)
        c["_stamp"] = xs
    keep.sort(key=lambda c: -c["score"])
    for i, c in enumerate(keep):
        st_ = c.pop("_stamp")
        c["rank"] = i + 1
        if i < max_ship:
            c["stamp"] = base64.b64encode(np.ascontiguousarray(st_, "<f4").tobytes()).decode()
    log.info("%d candidates scored (pair %s→%s)", len(keep), field.epochs[a].year, field.epochs[b].year)
    return dict(pair=dict(a_year=ya, b_year=yb), candidates=keep, model=have_model, stamp_shape=[6, 21, 21],
                preprocess="asinh(x/3)", threshold=FIELD_THRESHOLD,
                calibration="threshold 0.9 on best-of-9-offsets scores: 0.6% of 628 real static Gaia stars exceed it; "
                            "Barnard's Star 1.00, ε Indi B 1.00, WISE 0855 0.97")
