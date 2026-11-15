"""Training data for the mover CNN by injection into REAL SPHEREx data.

A sample is a 6×S×S stamp in S/N units:
    [A_all, B_all, (B−A)_all, A_red, B_red, (B−A)_red]
where *_all combines D1–D6 and *_red combines D4–D6 (cold brown dwarfs are invisible blueward of ~3 µm),
A and B are two epochs' coadds, and B−A is their difference.

Positives  : synthetic point sources injected into each epoch × detector coadd with that coadd's own ePSF,
             at positions consistent with linear motion (random S/N, speed, direction, spectral shape).
Negatives  : real static sources, empty sky, real difference-image peaks (artifacts, saturated-star residuals,
             edges), and synthetic *static variables* (flux changes, position does not) — so the network learns
             motion rather than "anything changed".
Synthetic injections exist only here (training/evaluation); the viewer shows real data only.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from blink.config import PIXEL_SCALE_ARCSEC  # noqa: E402
from blink.stamps import ALL, RED, STAMP, EpochData, Field, H  # noqa: E402,F401

SPECTRA = {
    "flat": {d: 1.0 for d in ALL},
    "red": {1: 0.0, 2: 0.02, 3: 0.08, 4: 0.5, 5: 1.0, 6: 1.0},  # Y/T-dwarf-like: all light beyond 3 µm
    "blue": {1: 1.0, 2: 0.9, 3: 0.7, 4: 0.45, 5: 0.3, 6: 0.25},  # stellar Rayleigh–Jeans tail
}


def spectrum_snr(kind: str, total: float) -> dict:
    w = SPECTRA[kind]
    norm = np.sqrt(sum(v * v for v in w.values()))  # so the combined all-detector S/N ≈ total
    return {d: total * v / norm for d, v in w.items()}


def make_samples(field: Field, n_pos: int, n_neg: int, rng: np.random.Generator, meta_out: list | None = None):
    """Returns X [N,6,S,S], y [N], plus per-sample metadata (type, snr, speed)."""
    X, Y, M = [], [], []
    ne = len(field.epochs)
    if ne < 2:
        return np.zeros((0, 6, STAMP, STAMP), np.float32), np.zeros(0), []

    years = [e.year for e in field.epochs]
    long_pairs = [(i, j) for i in range(ne) for j in range(i + 1, ne) if years[j] - years[i] >= 0.35]

    def pick_pair():
        # survey visits ~6 months apart; pairs a few weeks apart cannot show sub-arcsecond-per-year motion
        if long_pairs:
            return long_pairs[rng.integers(len(long_pairs))]
        a, b = sorted(rng.choice(ne, 2, replace=False))
        return int(a), int(b)

    margin = H + 4
    tries = 0
    # ---------------- positives: injected movers
    while sum(Y) < n_pos and tries < n_pos * 6:
        tries += 1
        a, b = pick_pair()
        dt = field.epochs[b].year - field.epochs[a].year
        speed = float(np.exp(rng.uniform(np.log(0.3), np.log(15.0))))  # ″/yr
        ang = rng.uniform(0, 2 * np.pi)
        disp = speed * dt / PIXEL_SCALE_ARCSEC
        if disp < 0.35:  # below ~1/3 pixel the mover is not visibly moving: not a fair positive
            continue
        xa, ya = rng.uniform(margin, field.n - margin, 2)
        xb, yb = xa + disp * np.cos(ang), ya + disp * np.sin(ang)
        if field.near_excluded(xa, ya, 10):
            continue
        snr = float(np.exp(rng.uniform(np.log(3.0), np.log(400.0))))
        kind = rng.choice(["flat", "red", "blue"], p=[0.45, 0.3, 0.25])
        var_amp = float(np.exp(rng.normal(0, 0.15)))  # a little intrinsic variability
        inj_a = field.point_source(field.epochs[a], xa, ya, spectrum_snr(kind, snr))
        inj_b = field.point_source(field.epochs[b], xb, yb, spectrum_snr(kind, snr * var_amp))
        cx, cy = (xa + xb) / 2 + rng.normal(0, 0.7), (ya + yb) / 2 + rng.normal(0, 0.7)
        s = field.stamp(a, b, cx, cy, inj_a, inj_b)
        if s is None:
            continue
        X.append(s)
        Y.append(1)
        M.append(dict(type="injected_mover", snr=snr, speed=speed, disp_px=disp, spectrum=str(kind), dt=dt))

    # ---------------- negatives
    kinds = ["static_source", "sky", "diff_peak", "static_variable", "saturated_edge", "offcenter_mover"]
    probs = [0.28, 0.1, 0.18, 0.18, 0.06, 0.2]
    nneg = 0
    tries = 0
    while nneg < n_neg and tries < n_neg * 8:
        tries += 1
        a, b = pick_pair()
        kind = rng.choice(kinds, p=probs)
        meta = dict(type=str(kind))
        inj_a = inj_b = None
        if kind == "static_source":
            if not field.sources:
                continue
            src = field.sources[rng.integers(len(field.sources))]
            cx, cy = src["x"] + rng.normal(0, 0.7), src["y"] + rng.normal(0, 0.7)
            meta["snr"] = src["snr"]
        elif kind == "sky":
            cx, cy = rng.uniform(margin, field.n - margin, 2)
        elif kind == "saturated_edge":
            if not field.saturated:
                continue
            src = field.saturated[rng.integers(len(field.saturated))]
            r = src.get("mask_r", 3) + rng.uniform(0, 3)
            t = rng.uniform(0, 2 * np.pi)
            cx, cy = src["x"] + r * np.cos(t), src["y"] + r * np.sin(t)
        elif kind == "diff_peak":
            cand = field.diff_peaks(a, b, margin)
            if not len(cand):
                continue
            cy, cx = cand[rng.integers(len(cand))]
            cx, cy = cx + rng.normal(0, 0.5), cy + rng.normal(0, 0.5)
        elif kind == "offcenter_mover":
            # a real-looking mover 4–9 px from the stamp centre: the label is about the CENTRE only
            dt = field.epochs[b].year - field.epochs[a].year
            speed = float(np.exp(rng.uniform(np.log(1.0), np.log(15.0))))
            ang = rng.uniform(0, 2 * np.pi)
            disp = speed * dt / PIXEL_SCALE_ARCSEC
            cx, cy = rng.uniform(margin, field.n - margin, 2)
            off = rng.uniform(4, 9)
            phi = rng.uniform(0, 2 * np.pi)
            xa, ya = cx + off * np.cos(phi), cy + off * np.sin(phi)
            snr = float(np.exp(rng.uniform(np.log(6.0), np.log(400.0))))
            sk = rng.choice(["flat", "red", "blue"])
            inj_a = field.point_source(field.epochs[a], xa, ya, spectrum_snr(sk, snr))
            inj_b = field.point_source(field.epochs[b], xa + disp * np.cos(ang), ya + disp * np.sin(ang), spectrum_snr(sk, snr))
            meta.update(snr=snr, speed=speed, offset_px=off)
        else:  # static variable: same position, different brightness
            cx, cy = rng.uniform(margin, field.n - margin, 2)
            snr = float(np.exp(rng.uniform(np.log(4.0), np.log(60.0))))
            amp = float(np.exp(rng.uniform(np.log(1.5), np.log(8.0))))
            if rng.random() < 0.5:
                amp = 1 / amp
            sk = rng.choice(["flat", "red", "blue"])
            inj_a = field.point_source(field.epochs[a], cx, cy, spectrum_snr(sk, snr))
            inj_b = field.point_source(field.epochs[b], cx, cy, spectrum_snr(sk, snr * amp))
            meta.update(snr=snr, amp=amp)
            cx, cy = cx + rng.normal(0, 0.7), cy + rng.normal(0, 0.7)
        if field.near_excluded(cx, cy, 8):
            continue
        s = field.stamp(a, b, cx, cy, inj_a, inj_b)
        if s is None:
            continue
        X.append(s)
        Y.append(0)
        M.append(meta)
        nneg += 1
    if meta_out is not None:
        meta_out.extend(M)
    return np.stack(X) if X else np.zeros((0, 6, STAMP, STAMP), np.float32), np.array(Y, np.float32), M
