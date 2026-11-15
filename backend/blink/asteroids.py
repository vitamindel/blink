"""Known asteroids (SkyBoT) in a field at the times SPHEREx actually looked."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np

from .catalogs import skybot_cone
from .stack import Stack


def visits(st: Stack, gap_hours: float = 1.0) -> list[dict]:
    """Group exposures taken within `gap_hours` of each other (one SkyBoT query each)."""
    order = np.argsort([e.t_min_mjd for e in st.exposures])
    groups, cur = [], []
    for i in order:
        if cur and (st.exposures[i].t_min_mjd - st.exposures[cur[-1]].t_min_mjd) * 24 > gap_hours:
            groups.append(cur)
            cur = []
        cur.append(int(i))
    if cur:
        groups.append(cur)
    return [dict(mjd=float(np.mean([st.exposures[i].t_min_mjd for i in g])), members=g) for g in groups]


def field_asteroids(st: Stack, vmax: float = 21.5) -> dict:
    vs = visits(st)
    radius = st.fov_deg * 0.72

    def q(v):
        return [a for a in skybot_cone(st.ra, st.dec, radius, v["mjd"]) if a.get("vmag") is None or a["vmag"] <= vmax]

    with ThreadPoolExecutor(max_workers=4) as pool:
        res = list(pool.map(q, vs))
    out = []
    for v, objs in zip(vs, res):
        if objs:
            out.append(dict(mjd=v["mjd"], n_exposures=len(v["members"]),
                            detectors=sorted({st.exposures[i].detector for i in v["members"]}), objects=objs))
    names = {o["name"] for v in out for o in v["objects"]}
    return dict(n_visits=len(vs), n_visits_with_objects=len(out), n_objects=len(names), visits=out, vmax=vmax,
                source="IMCCE SkyBoT (geocentric)")
