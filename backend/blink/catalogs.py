"""External catalogues: Gaia DR3 (ESA TAP, IRSA fallback), AllWISE (IRSA TAP), SkyBoT (IMCCE).
All responses are cached on disk by URL."""
from __future__ import annotations

import csv
import io
import logging

import numpy as np

from . import net

log = logging.getLogger("blink.catalogs")
ESA_TAP = "https://gea.esac.esa.int/tap-server/tap/sync"
IRSA_TAP = "https://irsa.ipac.caltech.edu/TAP/sync"
GAIA_EPOCH = 2016.0


def _csv(body: bytes) -> list[dict]:
    return list(csv.DictReader(io.StringIO(body.decode("utf-8", "replace"))))


def gaia_cone(ra: float, dec: float, radius_deg: float, gmax: float = 19.5) -> list[dict]:
    q = (f"SELECT source_id, ra, dec, pmra, pmdec, pmra_error, pmdec_error, parallax, phot_g_mean_mag, "
         f"bp_rp, ruwe FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS',ra,dec), "
         f"CIRCLE('ICRS',{ra:.6f},{dec:.6f},{radius_deg:.4f})) AND phot_g_mean_mag < {gmax}")
    rows = None
    try:
        body = net.fetch(ESA_TAP, params={"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": q},
                         expect=b"source_id", retries=4, suffix=".csv")
        rows = _csv(body)
    except net.FetchError as e:
        log.warning("ESA Gaia failed (%s); trying IRSA", e)
        q2 = q.replace("gaiadr3.gaia_source", "gaia_dr3_source")
        body = net.fetch(IRSA_TAP, params={"LANG": "ADQL", "FORMAT": "csv", "QUERY": q2}, expect=b"source_id",
                         retries=4, suffix=".csv")
        rows = _csv(body)
    out = []
    for r in rows:
        def f(k):
            try:
                return float(r[k])
            except (TypeError, ValueError, KeyError):
                return None
        out.append(dict(source_id=r["source_id"], ra=f("ra"), dec=f("dec"), pmra=f("pmra"), pmdec=f("pmdec"),
                        pmra_error=f("pmra_error"), pmdec_error=f("pmdec_error"), parallax=f("parallax"),
                        g=f("phot_g_mean_mag"), bp_rp=f("bp_rp"), ruwe=f("ruwe")))
    return out


def propagate(ra, dec, pmra, pmdec, from_year, to_year):
    """Linear proper-motion propagation (mas/yr, pmra includes cos dec)."""
    dt = to_year - from_year
    pmra = np.nan_to_num(np.asarray(pmra, float))
    pmdec = np.nan_to_num(np.asarray(pmdec, float))
    dec2 = np.asarray(dec) + pmdec * dt / 3.6e6
    ra2 = np.asarray(ra) + pmra * dt / 3.6e6 / np.cos(np.radians(dec2))
    return ra2, dec2


def allwise_cone(ra: float, dec: float, radius_deg: float) -> list[dict]:
    q = (f"SELECT designation, ra, dec, w1mpro, w2mpro, w3mpro, w4mpro, pmra, pmdec FROM allwise_p3as_psd "
         f"WHERE CONTAINS(POINT('ICRS',ra,dec), CIRCLE('ICRS',{ra:.6f},{dec:.6f},{radius_deg:.4f}))=1")
    try:
        body = net.fetch(IRSA_TAP, params={"LANG": "ADQL", "FORMAT": "csv", "QUERY": q}, expect=b"designation",
                         retries=4, suffix=".csv")
    except net.FetchError as e:
        log.warning("AllWISE failed: %s", e)
        return []
    out = []
    for r in _csv(body):
        def f(k):
            try:
                return float(r[k])
            except (TypeError, ValueError, KeyError):
                return None
        out.append(dict(designation=r["designation"], ra=f("ra"), dec=f("dec"), w1=f("w1mpro"), w2=f("w2mpro"),
                        w3=f("w3mpro"), w4=f("w4mpro")))
    return out


SKYBOT = "https://ssp.imcce.fr/webservices/skybot/api/conesearch.php"


def _sexa_to_deg(ra_hms: str, dec_dms: str) -> tuple[float, float]:
    h, m, s = (float(v) for v in ra_hms.split())
    sign = -1 if dec_dms.strip().startswith("-") else 1
    d, dm, ds = (abs(float(v)) for v in dec_dms.replace("+", "").replace("-", "").split())
    return 15 * (h + m / 60 + s / 3600), sign * (d + dm / 60 + ds / 3600)


def skybot_cone(ra: float, dec: float, radius_deg: float, mjd: float) -> list[dict]:
    """Known solar-system objects in a cone at a given time (IMCCE SkyBoT, geocentric — SPHEREx is in LEO,
    so parallax is < 1″ for main-belt asteroids)."""
    import json

    jd = mjd + 2400000.5
    try:
        body = net.fetch(SKYBOT, params={"-ep": f"{jd:.5f}", "-ra": f"{ra:.5f}", "-dec": f"{dec:.5f}",
                                         "-rd": f"{radius_deg:.4f}", "-mime": "json", "-output": "basic", "-loc": "500",
                                         "-filter": "0", "-objFilter": "111"}, retries=4, timeout=60, suffix=".json")
    except net.FetchError as e:
        log.warning("SkyBoT failed: %s", e)
        return []
    txt = body.decode("utf-8", "replace").strip()
    if not txt.startswith("["):
        return []  # "no solar system object was found"
    out = []
    for r in json.loads(txt):
        try:
            ra_d, dec_d = _sexa_to_deg(r["RA (hms)"], r["DEC (dms)"])
        except (KeyError, ValueError):
            continue
        out.append(dict(name=r.get("Name"), number=r.get("Num"), cls=r.get("Class"), vmag=r.get("VMag (mag)"),
                        ra=ra_d, dec=dec_d, dra_arcsec_h=r.get("dRA (arcsec/h)"), ddec_arcsec_h=r.get("dDEC (arcsec/h)")))
    return out
