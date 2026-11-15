"""Prefetch + precompute everything the demo needs for the five challenge targets.

    python scripts/prefetch.py                # all targets, reuse caches
    python scripts/prefetch.py --refresh      # re-query IRSA (new weekly QR3 data / new release)
    python scripts/prefetch.py wise-0855      # one target

Supporting a new data release = edit COLLECTIONS in blink/config.py and run with --refresh."""
from __future__ import annotations

import argparse
import logging
import sys
import time

sys.path.insert(0, __file__.rsplit("scripts", 1)[0])
from blink import products  # noqa: E402
from blink.stack import get_stack  # noqa: E402
from blink.targets import TEST_TARGETS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logging.getLogger("blink.net").setLevel(logging.WARNING)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="*", default=list(TEST_TARGETS))
    ap.add_argument("--refresh", action="store_true", help="re-query IRSA and rebuild stacks")
    a = ap.parse_args()
    for slug in a.targets:
        t = TEST_TARGETS[slug]
        t0 = time.time()
        last = [0.0]

        def prog(stage, i, n):
            if time.time() - last[0] > 15 or i == n:
                last[0] = time.time()
                print(f"  {slug}: {stage} {i}/{n}", flush=True)

        try:
            st = get_stack(t.slug, *t.center, rebuild=a.refresh, refresh_search=a.refresh, progress=prog)
            products.export_target(t, st)
            print(f"OK {slug}: {len(st.exposures)} exposures, {time.time()-t0:.0f}s", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"FAILED {slug}: {e!r}", flush=True)


if __name__ == "__main__":
    main()
