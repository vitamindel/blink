"""Build the stack + flipbook for a target and save PNG strips per band (sanity check, no web needed).
Usage: python scripts/quicklook.py barnards-star [fov_deg]"""
from __future__ import annotations

import base64
import json
import logging
import sys
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

sys.path.insert(0, __file__.rsplit("scripts", 1)[0])
from blink.flipbook import build_flipbook  # noqa: E402
from blink.stack import get_stack  # noqa: E402
from blink.targets import resolve  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")


def dec(s, n):
    return np.frombuffer(base64.b64decode(s), "<f4").reshape(n, n)


def main(name="barnards-star", fov="0.1"):
    t = resolve(name)
    ra, de = t.center
    t0 = time.time()
    st = get_stack(t.slug, ra, de)
    print(f"stack: {st.sci.shape} in {time.time()-t0:.1f}s; versions {sorted(set(st.versions))}")
    print("flag names:", st.flag_names)
    fb = build_flipbook(st, float(fov))
    n = fb["width"]
    out = st_path = None
    bands = ["D1", "D2", "D3", "D4", "D5", "D6", "all"]
    eps = [e for e in fb["epochs"] if e["n_exposures"] >= 6]
    fig, axes = plt.subplots(len(bands), len(eps), figsize=(2.2 * len(eps), 2.2 * len(bands)), squeeze=False)
    for j, e in enumerate(eps):
        for i, b in enumerate(bands):
            ax = axes[i, j]
            ax.set_xticks([]), ax.set_yticks([])
            if b in e["bands"] and "data" in e["bands"][b]:
                a = dec(e["bands"][b]["data"], n)
                noise = e["bands"][b]["noise"]
                ax.imshow(np.arcsinh(a / (3 * noise)), origin="lower", cmap="gray", vmin=-1, vmax=5)
                ax.plot(n // 2, n // 2, "+", color="r", ms=6, alpha=.5)
            if i == 0:
                ax.set_title(f"E{e['index']} {e['date_mid']}\n{e['n_exposures']} exp", fontsize=8)
            if j == 0:
                ax.set_ylabel(b)
    fig.suptitle(f"{t.name} — {fb['release']} — {fb['fov_deg']*60:.1f}′ field")
    fig.tight_layout()
    from blink.config import PRODUCTS

    p = PRODUCTS / t.slug / f"quicklook_{fov}.png"
    fig.savefig(p, dpi=90)
    print("wrote", p)
    meta = {k: v for k, v in fb.items() if k not in ("epochs", "exposures")}
    meta["epochs"] = [{k: v for k, v in e.items() if k != "bands"} | {"bands": {b: {k: v for k, v in d.items() if k != "data"} for b, d in e["bands"].items()}} for e in fb["epochs"]]
    (PRODUCTS / t.slug / "flipbook_meta.json").write_text(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:])
