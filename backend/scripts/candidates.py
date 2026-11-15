"""Score ML mover candidates for targets from existing stacks + analysis.json. Usage: python scripts/candidates.py [slug ...]"""
from __future__ import annotations

import json
import logging
import sys
import time

sys.path.insert(0, __file__.rsplit("scripts", 1)[0])
from blink import products  # noqa: E402
from blink.candidates import find_candidates  # noqa: E402
from blink.config import FETCH_FOV_DEG  # noqa: E402
from blink.stack import Stack, stack_path  # noqa: E402
from blink.targets import TEST_TARGETS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
for slug in sys.argv[1:] or list(TEST_TARGETS):
    t0 = time.time()
    st = Stack.load(stack_path(slug, FETCH_FOV_DEG))
    a = json.loads((products.PRODUCTS / slug / "analysis.json").read_text())
    cs = find_candidates(st, a)
    products.write_json(products.PRODUCTS / slug / "candidates.json", products._clean(cs))
    top = cs["candidates"][:5]
    print(f"{slug}: {len(cs['candidates'])} candidates in {time.time()-t0:.0f}s; top: "
          + ", ".join(f"{c['kind']}#{c.get('source_id', '-')}={c['score']:.2f}" for c in top), flush=True)
