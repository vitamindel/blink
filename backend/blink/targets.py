"""Target resolution: names (CDS Sesame) and coordinates (decimal or sexagesimal), with proper-motion
propagation so fast movers (Barnard's Star, WISE 0855) are centred where they are *during SPHEREx*."""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass

import numpy as np

from . import net

SESAME = "https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV"
REF_EPOCH = 2000.0  # SIMBAD/Sesame positions are ICRS at epoch J2000
SPHEREX_MID_EPOCH = 2026.0  # mid-point of DR1 + QR3 coverage (Aug 2025 – late 2026)


@dataclass
class Target:
    slug: str
    name: str
    ra: float  # catalogue position (deg, ICRS, at ref_epoch)
    dec: float
    pmra: float = 0.0  # mas/yr, includes cos(dec)
    pmdec: float = 0.0
    ref_epoch: float = REF_EPOCH
    kind: str = ""
    blurb: str = ""

    def at(self, year: float) -> tuple[float, float]:
        """Linear proper-motion propagation (fine for decades at these speeds)."""
        dt = year - self.ref_epoch
        dec = self.dec + self.pmdec * dt / 3.6e6
        ra = self.ra + self.pmra * dt / 3.6e6 / np.cos(np.radians(0.5 * (self.dec + dec)))
        return float(ra % 360), float(dec)

    @property
    def center(self) -> tuple[float, float]:
        return self.at(SPHEREX_MID_EPOCH)

    def to_dict(self):
        d = asdict(self)
        d["ra_now"], d["dec_now"] = self.center
        return d


# Values from CDS Sesame/SIMBAD (Gaia DR3 where available), retrieved 2026-11-14.
TEST_TARGETS = {
    "barnards-star": Target("barnards-star", "Barnard's Star", 269.4520769586187, 4.69336496657667, -801.551, 10362.394,
                            kind="M4 red dwarf", blurb="Fastest proper motion of any star: 10.4″ per year."),
    "eps-indi-b": Target("eps-indi-b", "Epsilon Indi B", 331.04414658852124, -56.78284419511611, 3981.977, -2466.832,
                         kind="T1+T6 brown dwarf binary", blurb="Nearest brown dwarfs to the Sun after Luhman 16, 4.7″/yr."),
    "wise-0855": Target("wise-0855", "WISE 0855−0714", 133.81890825, -7.247048, -8123.7, 673.2,
                        kind="Y4 brown dwarf", blurb="Coldest known brown dwarf (~285 K), 8.2″/yr. Invisible below 3 µm."),
    "rw-aurigae": Target("rw-aurigae", "RW Aurigae", 76.95652603458, 30.40143817389, 7.23, -20.33,
                         kind="T Tauri binary", blurb="Young star whose disk has been dimming it erratically since 2010."),
    "r-draconis": Target("r-draconis", "R Draconis", 248.16761083295, 66.75497941722, -20.643, 6.149,
                         kind="Mira variable", blurb="Pulsating giant, ~245 day period, changes brightness many-fold."),
}
ALIASES = {
    "barnard": "barnards-star", "barnards star": "barnards-star", "barnard's star": "barnards-star", "gj 699": "barnards-star",
    "eps indi b": "eps-indi-b", "epsilon indi b": "eps-indi-b", "ε indi b": "eps-indi-b", "eps ind b": "eps-indi-b",
    "wise 0855": "wise-0855", "wise0855": "wise-0855", "wise 0855-0714": "wise-0855", "wise j0855-0714": "wise-0855",
    "wise j085510.83-071442.5": "wise-0855",
    "rw aur": "rw-aurigae", "rw aurigae": "rw-aurigae", "r dra": "r-draconis", "r draconis": "r-draconis",
}


def _sesame(name: str) -> Target:
    url = f"{SESAME}?{requests_quote(name)}"
    body = net.fetch(url, cache=True, retries=4, suffix=".xml").decode("utf-8", "replace")

    def grab(tag):
        m = re.search(rf"<{tag}>([^<]+)</{tag}>", body)
        return float(m.group(1)) if m else None

    ra, dec = grab("jradeg"), grab("jdedeg")
    if ra is None:
        raise LookupError(f"Could not resolve '{name}'")
    m = re.search(r"<oname>([^<]+)</oname>", body)
    nm = m.group(1) if m else name
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return Target(slug, nm.replace("NAME ", "").replace("V* ", "").replace("* ", ""), ra, dec,
                  grab("pmRA") or 0.0, grab("pmDE") or 0.0)


def requests_quote(s: str) -> str:
    from urllib.parse import quote

    return quote(s)


_SEXA = re.compile(r"[hdms:°'\"′″]")


def parse_coords(text: str) -> tuple[float, float] | None:
    """Accept '269.45 4.69', '269.45, +4.69', '17h57m48.5s +04d41m36s', '17:57:48.5 +04:41:36'."""
    t = text.strip().replace(",", " ")
    try:
        parts = t.split()
        if len(parts) == 2 and not _SEXA.search(t):
            ra, dec = float(parts[0]), float(parts[1])
            if 0 <= ra < 360 and -90 <= dec <= 90:
                return ra, dec
    except ValueError:
        pass
    try:
        from astropy import units as u
        from astropy.coordinates import SkyCoord

        c = SkyCoord(t, unit=(u.hourangle, u.deg))
        return float(c.ra.deg), float(c.dec.deg)
    except Exception:  # noqa: BLE001
        return None


def resolve(query: str) -> Target:
    q = query.strip()
    key = ALIASES.get(q.lower(), q.lower())
    if key in TEST_TARGETS:
        return TEST_TARGETS[key]
    c = parse_coords(q)
    if c:
        ra, dec = c
        return Target(f"{ra:.4f}{dec:+.4f}", f"{ra:.4f}, {dec:+.4f}", ra, dec, ref_epoch=SPHEREX_MID_EPOCH)
    return _sesame(q)
