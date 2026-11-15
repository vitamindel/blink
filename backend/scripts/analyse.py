"""Run the M2 motion analysis for targets and write data/products/<slug>/analysis.json.
Usage: python scripts/analyse.py [slug ...]"""
from __future__ import annotations

import logging
import sys
import time

sys.path.insert(0, __file__.rsplit("scripts", 1)[0])
from blink import products  # noqa: E402
from blink.analysis import analyse  # noqa: E402
from blink.config import FETCH_FOV_DEG  # noqa: E402
from blink.stack import Stack, stack_path  # noqa: E402
from blink.targets import TEST_TARGETS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logging.getLogger("blink.net").setLevel(logging.WARNING)

for slug in sys.argv[1:] or list(TEST_TARGETS):
    t0 = time.time()
    st = Stack.load(stack_path(slug, FETCH_FOV_DEG))
    a = analyse(st)
    products.write_json(products.PRODUCTS / slug / "analysis.json", products._clean(a))
    from blink.candidates import find_candidates, model_available

    if model_available():
        cs = find_candidates(st, a)
        products.write_json(products.PRODUCTS / slug / "candidates.json", products._clean(cs))
        top = cs["candidates"][:3]
        print(f"{slug}: top candidates " + ", ".join(f"{c['kind']}#{c.get('source_id','-')} {c['score']:.2f}" for c in top))
    c = st.n // 2
    near = sorted([s for s in a["sources"] if "pm" in s], key=lambda s: (s["x"] - c) ** 2 + (s["y"] - c) ** 2)[:1]
    for s in near:
        g = s.get("gaia") or {}
        print(f"{slug}: centre source pm={s['pm']:.0f}±{s['epm']:.0f} mas/yr (Gaia {g.get('pm')}) sig={s['pm_sig']:.1f} "
              f"n_ep={s['n_epochs']} sep={((s['x']-c)**2+(s['y']-c)**2)**.5:.1f}px")
    gc = a["gaia_comparison"]
    print(f"{slug}: {len(a['sources'])} sources, movers={len(a['movers'])}, gaia n={gc.get('n')} "
          f"scatter={gc.get('robust_scatter_mas_yr', 0):.0f} mas/yr, offsets={[e['offset_px'] for e in a['epochs']]}, "
          f"{time.time()-t0:.0f}s", flush=True)
