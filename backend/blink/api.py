"""Blink HTTP API.  Run:  uvicorn blink.api:app --port 8000  (from backend/)"""
from __future__ import annotations

import json
import logging
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import products
from .config import COLLECTIONS, FETCH_FOV_DEG, RELEASE_LABEL
from .stack import get_stack, stack_path
from .targets import TEST_TARGETS, Target, parse_coords, resolve

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
logging.getLogger("blink.net").setLevel(logging.WARNING)
log = logging.getLogger("blink.api")

app = FastAPI(title="Blink API", version="0.1")
app.add_middleware(GZipMiddleware, minimum_size=2048)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_pool = ThreadPoolExecutor(max_workers=2)
_jobs: dict[str, dict] = {}
_by_slug: dict[str, str] = {}
_lock = threading.Lock()


@app.get("/api/health")
def health():
    return {"ok": True, "release": RELEASE_LABEL, "collections": COLLECTIONS}


@app.get("/api/targets")
def targets():
    return [t.to_dict() for t in TEST_TARGETS.values()]


@app.get("/api/resolve")
def api_resolve(q: str):
    try:
        return resolve(q).to_dict()
    except LookupError as e:
        raise HTTPException(404, str(e)) from e
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Name resolver unavailable: {e}") from e


def _target_for(ra: float | None, dec: float | None, target: str | None) -> Target:
    if target and target in TEST_TARGETS:
        return TEST_TARGETS[target]
    if target:
        try:
            return resolve(target)
        except Exception:  # noqa: BLE001
            pass
    if ra is None or dec is None:
        raise HTTPException(400, "Give ra & dec (deg) or a target name")
    return Target(f"{ra:.4f}{dec:+.4f}", f"{ra:.4f}, {dec:+.4f}", ra, dec, ref_epoch=2026.0)


def _run_job(job_id: str, t: Target, kind: str = "flipbook"):
    job = _jobs[job_id]

    def prog(stage, i, n):
        job.update(stage=stage, i=i, n=n)

    try:
        job.update(stage="search", i=0, n=0)
        st = get_stack(t.slug, *t.center, FETCH_FOV_DEG, progress=prog)
        job.update(stage="coadd", i=0, n=0)
        products.export_target(t, st)
        if kind == "analysis":
            from .analysis import analyse

            job.update(stage="astrometry", i=0, n=0)
            a = analyse(st, progress=prog)
            products.write_json(products.PRODUCTS / t.slug / "analysis.json", products._clean(a))
            from .candidates import find_candidates, model_available

            if model_available():
                job.update(stage="candidates", i=0, n=0)
                products.write_json(products.PRODUCTS / t.slug / "candidates.json", products._clean(find_candidates(st, a)))
        job.update(status="done", stage="done")
    except Exception as e:  # noqa: BLE001
        log.error("job %s failed: %s", job_id, traceback.format_exc())
        job.update(status="error", error=str(e))
    finally:
        job["finished"] = time.time()


@app.get("/api/flipbook")
def flipbook(ra: float | None = None, dec: float | None = None, target: str | None = None,
             fov: float = Query(6.0, description="field of view, arcmin (3, 6 or 12)")):
    t = _target_for(ra, dec, target)
    fov_deg = fov / 60.0
    p = products.product_path(t.slug, "flipbook", fov_deg)
    if p.exists():
        return FileResponse(p, media_type="application/json", headers={"Cache-Control": "public, max-age=600"})
    if stack_path(t.slug, FETCH_FOV_DEG).exists():  # stack cached, product for this FOV missing
        from .stack import Stack

        products.export_target(t, Stack.load(stack_path(t.slug, FETCH_FOV_DEG)))
        return FileResponse(p, media_type="application/json")
    with _lock:
        jid = _by_slug.get(t.slug)
        if jid is None or _jobs[jid].get("status") == "error":
            jid = uuid.uuid4().hex[:12]
            _jobs[jid] = dict(id=jid, status="running", stage="queued", i=0, n=0, target=t.to_dict(), started=time.time())
            _by_slug[t.slug] = jid
            _pool.submit(_run_job, jid, t)
    return JSONResponse(status_code=202, content=_jobs[jid])


def _start_job(t: Target, kind: str):
    key = f"{t.slug}:{kind}"
    with _lock:
        jid = _by_slug.get(key)
        if jid is None or _jobs[jid].get("status") == "error":
            jid = uuid.uuid4().hex[:12]
            _jobs[jid] = dict(id=jid, status="running", stage="queued", i=0, n=0, target=t.to_dict(), started=time.time())
            _by_slug[key] = jid
            _pool.submit(_run_job, jid, t, kind)
    return JSONResponse(status_code=202, content=_jobs[jid])


@app.get("/api/analysis")
def analysis(ra: float | None = None, dec: float | None = None, target: str | None = None):
    """Sources, per-epoch astrometry, proper-motion fits and the Gaia DR3 comparison."""
    t = _target_for(ra, dec, target)
    p = products.PRODUCTS / t.slug / "analysis.json"
    if p.exists():
        return FileResponse(p, media_type="application/json", headers={"Cache-Control": "public, max-age=600"})
    return _start_job(t, "analysis")


_cand_lock = threading.Lock()


@app.get("/api/candidates")
def candidates(ra: float | None = None, dec: float | None = None, target: str | None = None):
    """CNN-ranked mover candidates with their 6×21×21 stamps (for in-browser re-scoring)."""
    import json as _json

    from .candidates import find_candidates, model_available

    t = _target_for(ra, dec, target)
    p = products.PRODUCTS / t.slug / "candidates.json"
    if p.exists():
        return FileResponse(p, media_type="application/json", headers={"Cache-Control": "public, max-age=600"})
    ap = products.PRODUCTS / t.slug / "analysis.json"
    if not ap.exists():
        return _start_job(t, "analysis")
    if not model_available():
        raise HTTPException(503, "Mover model not trained yet")
    with _cand_lock:
        if not p.exists():
            res = find_candidates(_stack_cache(t.slug), _json.loads(ap.read_text()))
            products.write_json(p, products._clean(res))
    return FileResponse(p, media_type="application/json")


@app.get("/api/gaia")
def gaia(ra: float | None = None, dec: float | None = None, target: str | None = None, gmax: float = 19.0):
    """Gaia DR3 sources in the field (epoch 2016.0 positions + proper motions) for the overlay."""
    from .catalogs import gaia_cone

    t = _target_for(ra, dec, target)
    p = products.PRODUCTS / t.slug / "gaia.json"
    if not p.exists():
        cra, cdec = t.center
        rows = gaia_cone(cra, cdec, FETCH_FOV_DEG * 0.72, gmax=gmax)
        products.write_json(p, products._clean(dict(epoch=2016.0, sources=[
            {k: r[k] for k in ("source_id", "ra", "dec", "pmra", "pmdec", "g", "parallax")} for r in rows])))
    return FileResponse(p, media_type="application/json", headers={"Cache-Control": "public, max-age=86400"})


_ast_lock = threading.Lock()


@app.get("/api/asteroids")
def asteroids(ra: float | None = None, dec: float | None = None, target: str | None = None):
    """Known asteroids (IMCCE SkyBoT) in the field at each SPHEREx visit."""
    from .asteroids import field_asteroids

    t = _target_for(ra, dec, target)
    p = products.PRODUCTS / t.slug / "asteroids.json"
    if not p.exists():
        if not stack_path(t.slug, FETCH_FOV_DEG).exists():
            raise HTTPException(409, "Load the flipbook for this field first")
        with _ast_lock:
            if not p.exists():
                products.write_json(p, products._clean(field_asteroids(_stack_cache(t.slug))))
    return FileResponse(p, media_type="application/json", headers={"Cache-Control": "public, max-age=3600"})


_phot_lock = threading.Lock()


@app.get("/api/photometry")
def photometry(sra: float, sdec: float, pmra: float = 0.0, pmdec: float = 0.0, t_ref: float = 2026.0,
               ra: float | None = None, dec: float | None = None, target: str | None = None):
    """Forced ePSF photometry of one (moving) source in every exposure and every epoch×detector coadd:
    light curves (flux vs time) and the raw material for spectra (flux vs wavelength)."""
    import hashlib

    from .analysis import forced_photometry
    from .stack import Stack

    t = _target_for(ra, dec, target)
    key = hashlib.sha1(f"{sra:.6f},{sdec:.6f},{pmra:.1f},{pmdec:.1f},{t_ref:.3f}".encode()).hexdigest()[:16]
    p = products.PRODUCTS / t.slug / "phot" / f"{key}.json"
    if p.exists():
        return FileResponse(p, media_type="application/json")
    sp = stack_path(t.slug, FETCH_FOV_DEG)
    if not sp.exists():
        raise HTTPException(409, "Load the flipbook for this field first")
    with _phot_lock:
        st = _stack_cache(t.slug)
        res = forced_photometry(st, sra, sdec, pmra, pmdec, t_ref)
    products.write_json(p, products._clean(res))
    return FileResponse(p, media_type="application/json")


@app.get("/api/spectrum")
def spectrum(sra: float, sdec: float, pmra: float = 0.0, pmdec: float = 0.0, t_ref: float = 2026.0,
             ra: float | None = None, dec: float | None = None, target: str | None = None):
    """SPHEREx spectrum (102 channels) from forced photometry in every exposure + template classification."""
    import hashlib
    import json as _json

    from .analysis import forced_photometry
    from .classify import bin_spectrum, classify

    t = _target_for(ra, dec, target)
    key = hashlib.sha1(f"spec{sra:.6f},{sdec:.6f},{pmra:.1f},{pmdec:.1f},{t_ref:.3f}".encode()).hexdigest()[:16]
    p = products.PRODUCTS / t.slug / "spec" / f"{key}.json"
    if p.exists():
        return FileResponse(p, media_type="application/json")
    if not stack_path(t.slug, FETCH_FOV_DEG).exists():
        raise HTTPException(409, "Load the flipbook for this field first")
    with _phot_lock:
        ph = forced_photometry(_stack_cache(t.slug), sra, sdec, pmra, pmdec, t_ref)
    spec = bin_spectrum(ph["exposures"])
    # solar-system check: a known asteroid within 12″ at a visit
    match = None
    ap = products.PRODUCTS / t.slug / "asteroids.json"
    if ap.exists():
        import numpy as np

        for v in _json.loads(ap.read_text()).get("visits", []):
            for o in v["objects"]:
                if np.hypot((o["ra"] - sra) * np.cos(np.radians(sdec)), o["dec"] - sdec) * 3600 < 12:
                    match = o["name"]
    saturated = sum(1 for r in ph["exposures"] if r.get("method") == "wing") > len(ph["exposures"]) / 2
    res = dict(spectrum=spec, n_exposures=len(ph["exposures"]), saturated=saturated,
               points=[dict(wave_um=r["wave_um"], flux_ujy=r["flux_ujy"], eflux_ujy=r["eflux_ujy"], detector=r["detector"])
                       for r in ph["exposures"] if r.get("method") == "psf" and not r.get("masked")],
               classification=classify(spec, skybot_match=match) if not saturated else
               dict(label="saturated — no spectrum", family=None, caveats=[
                   "The core is saturated in most exposures; SPHEREx cannot measure this star's spectrum directly."]))
    products.write_json(p, products._clean(res))
    return FileResponse(p, media_type="application/json")


_stacks: dict = {}


def _stack_cache(slug: str):
    from .stack import Stack

    if slug not in _stacks:
        if len(_stacks) > 3:
            _stacks.pop(next(iter(_stacks)))
        _stacks[slug] = Stack.load(stack_path(slug, FETCH_FOV_DEG))
    return _stacks[slug]


@app.get("/api/jobs/{jid}")
def job(jid: str):
    if jid not in _jobs:
        raise HTTPException(404, "unknown job")
    return _jobs[jid]


@app.get("/api/parse")
def api_parse(q: str):
    c = parse_coords(q)
    if not c:
        raise HTTPException(400, "not coordinates")
    return {"ra": c[0], "dec": c[1]}
