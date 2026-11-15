"""Extra SPHEREx fields used ONLY as backgrounds for synthetic-injection training / evaluation of the mover CNN.
They are never shown in the viewer as discoveries. Fetch with:  python ml/fields.py"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# (slug, ra, dec, note) — diverse source density; two near the ecliptic for SkyBoT tests
TRAIN_FIELDS = [
    ("f-cosmos", 150.10, 2.20, "high latitude, sparse"),
    ("f-cdfs", 53.12, -27.80, "high latitude, sparse"),
    ("f-goodsn", 189.20, 62.24, "high latitude, sparse"),
    ("f-nep", 270.00, 66.56, "north ecliptic pole, many epochs"),
    ("f-plane1", 283.00, -4.00, "Galactic plane, crowded"),
    ("f-plane2", 120.00, -30.00, "mid latitude"),
    ("f-south", 60.00, -48.00, "mid latitude"),
    ("f-ecl1", 45.00, 16.50, "near ecliptic (asteroids)"),
    ("f-ecl2", 180.00, 0.50, "near ecliptic (asteroids)"),
    ("f-midlat", 330.00, 10.00, "mid latitude"),
]
# held out for evaluation (never trained on)
TEST_FIELDS = {"f-goodsn", "f-plane1"}


def main():
    import logging
    import time

    from blink.config import FETCH_FOV_DEG
    from blink.stack import get_stack

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("blink.net").setLevel(logging.WARNING)
    for slug, ra, dec, note in TRAIN_FIELDS:
        t0 = time.time()
        try:
            st = get_stack(slug, ra, dec, FETCH_FOV_DEG)
            print(f"OK {slug} ({note}): {len(st.exposures)} exposures, {time.time()-t0:.0f}s", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"FAILED {slug}: {e!r}", flush=True)


if __name__ == "__main__":
    main()
