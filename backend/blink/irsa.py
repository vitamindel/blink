"""SPHEREx search (IRSA SIA2, with TAP fallback) and cutout download.

Query pattern follows IRSA's SPHEREx tutorials (spherex-intro: SIA2 on spherex_dr1/spherex_qr3;
spherex-cutouts: TAP join of spherex.artifact/spherex.plane and `?center=..&size=..` cutouts)."""
from __future__ import annotations

import gzip
import hashlib
import io
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass

import numpy as np
from astropy.io.votable import parse_single_table

from . import net
from .config import COLLECTIONS, MAX_WORKERS, SIA_CACHE, SIA_URL, TAP_URL

log = logging.getLogger("blink.irsa")


@dataclass
class Exposure:
    obs_id: str  # e.g. 2025W33_2C_0321_1
    collection: str  # spherex_dr1 / spherex_qr3
    detector: int  # 1..6
    em_min_um: float
    em_max_um: float
    t_min_mjd: float
    t_max_mjd: float
    exptime_s: float
    access_url: str
    did: str

    @property
    def uid(self) -> str:
        return f"{self.obs_id}D{self.detector}"

    def cutout_url(self, ra: float, dec: float, size_deg: float) -> str:
        return f"{self.access_url}?center={ra:.6f},{dec:.6f}&size={size_deg:.4f}"

    def to_dict(self):
        return asdict(self)


def _parse_sia_votable(body: bytes) -> list[Exposure]:
    t = parse_single_table(io.BytesIO(body)).to_table(use_names_over_ids=True)
    out = []
    for r in t:
        band = str(r["energy_bandpassname"])  # "SPHEREx-D3"
        if not band.startswith("SPHEREx-D"):
            continue
        out.append(
            Exposure(
                obs_id=str(r["obs_id"]),
                collection=str(r["obs_collection"]),
                detector=int(band[-1]),
                em_min_um=float(r["em_min"]) * 1e6,
                em_max_um=float(r["em_max"]) * 1e6,
                t_min_mjd=float(r["t_min"]),
                t_max_mjd=float(r["t_max"]),
                exptime_s=float(r["t_exptime"]),
                access_url=str(r["access_url"]),
                did=str(r["obs_publisher_did"]),
            )
        )
    return out


def _tap_query(ra: float, dec: float) -> list[Exposure]:
    """Fallback (and fresher: no ~1 day SIA ingest delay). Pattern from IRSA spherex-cutouts notebook."""
    q = f"""SELECT a.uri, p.energy_bandpassname, p.energy_bounds_lower, p.energy_bounds_upper,
       p.time_bounds_lower, p.time_bounds_upper, p.time_exposure, p.obs_publisher_did
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {ra}, {dec}), p.poly) ORDER BY p.time_bounds_lower"""
    body = net.fetch(TAP_URL, params={"QUERY": q, "LANG": "ADQL", "FORMAT": "votable"}, expect=b"<?xml",
                     cache=False, retries=4)
    t = parse_single_table(io.BytesIO(body)).to_table(use_names_over_ids=True)
    out = []
    for r in t:
        uri = str(r["uri"])
        coll = "spherex_qr3" if "/qr3/" in uri else "spherex_dr1" if "/dr1/" in uri else "other"
        if coll not in COLLECTIONS or "_deep" in uri:
            continue
        did = str(r["obs_publisher_did"])
        obs_id = did.split("?")[-1].split("/")[0]
        out.append(Exposure(obs_id, coll, int(str(r["energy_bandpassname"])[-1]),
                            float(r["energy_bounds_lower"]) * 1e6, float(r["energy_bounds_upper"]) * 1e6,
                            float(r["time_bounds_lower"]), float(r["time_bounds_upper"]),
                            float(r["time_exposure"]), "https://irsa.ipac.caltech.edu/" + uri.lstrip("/"), did))
    return out


def find_exposures(ra: float, dec: float, collections=COLLECTIONS, refresh: bool = False) -> list[Exposure]:
    """All Spectral Image MEFs whose footprint contains (ra, dec), sorted by time."""
    key = hashlib.sha1(f"{ra:.5f},{dec:.5f},{sorted(collections)}".encode()).hexdigest()[:16]
    path = SIA_CACHE / f"{key}.json"
    if path.exists() and not refresh:
        return [Exposure(**d) for d in json.loads(path.read_text())]
    exps: list[Exposure] = []
    try:
        for c in collections:
            body = net.fetch(SIA_URL, params={"COLLECTION": c, "POS": f"CIRCLE {ra} {dec} 0.0003"},
                             expect=b"<?xml", cache=False, retries=8 if not path.exists() else 3)
            exps += _parse_sia_votable(body)
    except net.FetchError as e:
        log.warning("SIA failed (%s); trying TAP", e)
        try:
            exps = _tap_query(ra, dec)
        except net.FetchError:
            if path.exists():  # IRSA down: serve the last good exposure list
                log.warning("TAP failed too; using cached exposure list %s", path.name)
                return [Exposure(**d) for d in json.loads(path.read_text())]
            raise
    # dedupe by uid (keep the latest collection listing)
    uniq = {e.uid: e for e in exps}
    exps = sorted(uniq.values(), key=lambda e: (e.t_min_mjd, e.detector))
    path.write_text(json.dumps([e.to_dict() for e in exps]))
    return exps


def _valid_fits(body: bytes) -> bool:
    return body.startswith(b"SIMPLE") or body[:2] == b"\x1f\x8b"


def get_cutout_bytes(exp: Exposure, ra: float, dec: float, size_deg: float) -> bytes:
    body = net.fetch(exp.cutout_url(ra, dec, size_deg), validate=_valid_fits, suffix=".fits", retries=10)
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    return body


def fetch_cutouts(exps: list[Exposure], ra: float, dec: float, size_deg: float, workers: int = MAX_WORKERS,
                  progress=None) -> dict[str, bytes | None]:
    """Parallel download; returns uid -> FITS bytes (None on permanent failure)."""
    out: dict[str, bytes | None] = {}
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(get_cutout_bytes, e, ra, dec, size_deg): e for e in exps}
        for i, f in enumerate(as_completed(futs)):
            e = futs[f]
            try:
                out[e.uid] = f.result()
            except Exception as ex:  # noqa: BLE001
                log.warning("cutout failed %s: %s", e.uid, ex)
                out[e.uid] = None
            if progress:
                progress(i + 1, len(exps))
    log.info("fetched %d cutouts in %.1fs", len(exps), time.time() - t0)
    return out
