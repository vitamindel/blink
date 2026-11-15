"""M0 data spike: list every SPHEREx exposure covering a target, group into epochs, fetch cutouts,
and inspect one MEF. Usage: python -m scripts.m0_spike [target]"""
from __future__ import annotations

import collections
import io
import json
import logging
import sys
import time

from astropy.io import fits
from astropy.time import Time

sys.path.insert(0, __file__.rsplit("scripts", 1)[0])
from blink import irsa  # noqa: E402
from blink.config import EPOCH_GAP_DAYS, FETCH_FOV_DEG, PRODUCTS  # noqa: E402
from blink.targets import resolve  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")


def main(name="barnards-star"):
    t = resolve(name)
    ra, dec = t.center
    print(f"Target {t.name}: catalogue {t.ra:.5f} {t.dec:+.5f} (J2000) -> 2026.0 {ra:.5f} {dec:+.5f}")
    t0 = time.time()
    exps = irsa.find_exposures(ra, dec)
    print(f"{len(exps)} exposures found in {time.time()-t0:.1f}s")

    epochs, cur = [], []
    for e in exps:
        if cur and e.t_min_mjd - cur[-1].t_min_mjd > EPOCH_GAP_DAYS:
            epochs.append(cur)
            cur = []
        cur.append(e)
    epochs.append(cur)

    rows = []
    print(f"\n{'#':>3} {'UTC start':19} {'det':>3} {'λ range (µm)':>14} {'texp(s)':>7} {'release':11} obs_id")
    for i, e in enumerate(exps):
        print(f"{i:3d} {Time(e.t_min_mjd, format='mjd').iso[:19]} D{e.detector}  {e.em_min_um:5.3f}–{e.em_max_um:5.3f} "
              f"{e.exptime_s:7.1f} {e.collection:11} {e.obs_id}")
        rows.append(e.to_dict())

    print(f"\n{len(epochs)} epochs (new epoch after a gap > {EPOCH_GAP_DAYS} d):")
    for i, ep in enumerate(epochs):
        d = collections.Counter(e.detector for e in ep)
        print(f"  E{i}: {Time(ep[0].t_min_mjd, format='mjd').iso[:10]} → {Time(ep[-1].t_max_mjd, format='mjd').iso[:10]}"
              f"  {len(ep):3d} exp  " + " ".join(f"D{k}:{d.get(k,0)}" for k in range(1, 7))
              + f"  [{', '.join(sorted({e.collection for e in ep}))}]")

    print(f"\nFetching {len(exps)} cutouts of {FETCH_FOV_DEG}° …")
    t0 = time.time()
    got = irsa.fetch_cutouts(exps, ra, dec, FETCH_FOV_DEG,
                             progress=lambda i, n: print(f"  {i}/{n}", end="\r") if i % 10 == 0 or i == n else None)
    ok = sum(v is not None for v in got.values())
    print(f"\n{ok}/{len(exps)} cutouts OK in {time.time()-t0:.1f}s, {sum(len(v) for v in got.values() if v)/1e6:.0f} MB")

    first = next(v for v in got.values() if v)
    with fits.open(io.BytesIO(first)) as h:
        h.info()
        print(repr(h[0].header)[:1500])
        print(repr(h[1].header)[:4000])
        fl = h["FLAGS"].header
        print("FLAG bits:", {k: fl[k] for k in fl if k.startswith("MSKN")})
        print(repr(h["EPSF"].header)[:2500])
        print(h["EPSF"].columns)
        print(repr(h["WCS-WAVE"].header)[:2000])
        print(h["WCS-WAVE"].columns)

    out = PRODUCTS / t.slug
    out.mkdir(parents=True, exist_ok=True)
    (out / "m0_exposures.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main(*(sys.argv[1:] or []))
