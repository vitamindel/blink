"""Precomputed, JSON-serialisable products per target (served by the API and copied into the web app
as a static fallback so the demo works even when IRSA — or the backend — is down)."""
from __future__ import annotations

import json
import logging
from pathlib import Path

from .config import PRODUCTS
from .flipbook import build_flipbook
from .stack import Stack
from .targets import Target

log = logging.getLogger("blink.products")
FOV_OPTIONS = {"3": 0.05, "6": 0.1, "12": 0.2}  # arcmin label -> deg


def fov_key(fov_deg: float) -> str:
    return min(FOV_OPTIONS, key=lambda k: abs(FOV_OPTIONS[k] - fov_deg))


def product_path(slug: str, kind: str, fov_deg: float | None = None) -> Path:
    suffix = f"_{fov_key(fov_deg)}" if fov_deg is not None else ""
    return PRODUCTS / slug / f"{kind}{suffix}.json"


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":"), allow_nan=False, default=_default), encoding="utf-8")
    tmp.replace(path)


def _default(o):
    import numpy as np

    if isinstance(o, (np.floating,)):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, np.bool_):
        return bool(o)
    raise TypeError(type(o))


def flipbook_payload(t: Target, st: Stack, fov_deg: float) -> dict:
    fb = build_flipbook(st, fov_deg)
    fb["target"] = t.to_dict()
    return _clean(fb)


def _clean(o):
    """Replace NaN/inf floats (not valid JSON) with None, recursively."""
    import math

    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    return o


def export_target(t: Target, st: Stack) -> None:
    for label, fov in FOV_OPTIONS.items():
        if fov > st.fov_deg + 1e-6:
            continue
        write_json(product_path(t.slug, "flipbook", fov), flipbook_payload(t, st, fov))
    log.info("exported products for %s", t.slug)
