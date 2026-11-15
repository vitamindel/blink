"""Central configuration. Supporting a new SPHEREx data release = edit COLLECTIONS and re-run `make prefetch`."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # blink/
DATA = Path(os.environ.get("BLINK_DATA", ROOT / "data"))
CACHE = DATA / "cache"
HTTP_CACHE = CACHE / "http"  # raw-ish downloads keyed by URL hash
SIA_CACHE = CACHE / "sia"  # exposure lists keyed by query hash
PRODUCTS = DATA / "products"  # computed flipbooks etc.
EXTERNAL = DATA / "external"

# --- Data release ----------------------------------------------------------
# As of Nov 2026 IRSA serves DR1 (Surveys 1+2, reprocessed) + QR3 (Surveys 3+4).
# QR2 is no longer searchable (download-only until Feb 2027); QR1 was retired.
RELEASE_LABEL = "SPHEREx DR1 + QR3"
COLLECTIONS = ["spherex_dr1", "spherex_qr3"]
DEEP_COLLECTIONS = ["spherex_dr1_deep", "spherex_qr3_deep"]

SIA_URL = "https://irsa.ipac.caltech.edu/SIA"
TAP_URL = "https://irsa.ipac.caltech.edu/TAP/sync"

PIXEL_SCALE_ARCSEC = 6.15  # SPHEREx native pixel (≈6.2")
DEFAULT_FOV_DEG = 0.1
FETCH_FOV_DEG = 0.2  # prefetch size; smaller views are cropped from it
MAX_WORKERS = int(os.environ.get("BLINK_WORKERS", "8"))

# epochs: exposures separated by more than this many days start a new epoch
EPOCH_GAP_DAYS = 7.0

DETECTORS = {
    1: (0.75, 1.11),
    2: (1.10, 1.64),
    3: (1.63, 2.42),
    4: (2.40, 3.82),
    5: (3.81, 4.42),
    6: (4.41, 5.00),
}

# FLAGS bits that make a pixel unusable for coadds. Names from the FLAGS header (MSKNnnnn).
BAD_BITS = {
    0: "TRANSIENT",
    1: "OVERFLOW",
    2: "SUR_ERROR",
    6: "NONFUNC",
    7: "DICHROIC",
    9: "MISSING_DATA",
    10: "HOT",
    11: "COLD",
    15: "NONLINEAR",
    17: "PERSIST",
    19: "OUTLIER",
}
# Contamination bits we report (not masked by default — they mark real-but-suspicious light)
CONTAM_BITS = {20: "CROSSTALK", 22: "GHOST", 23: "GHOST_FPA", 24: "GHOST_EXT", 25: "STREAK", 26: "BLOOM", 27: "SNOWBALL", 28: "HALO"}
SOURCE_BIT = 21

for _d in (HTTP_CACHE, SIA_CACHE, PRODUCTS, EXTERNAL):
    _d.mkdir(parents=True, exist_ok=True)
