"""HTTP with retries/backoff and a disk cache keyed by URL. IRSA is often busy (503 "Server busy",
502 proxy errors), so every network call goes through `fetch`."""
from __future__ import annotations

import hashlib
import logging
import random
import time
from pathlib import Path

import requests

from .config import HTTP_CACHE

log = logging.getLogger("blink.net")
_session = requests.Session()
_session.headers["User-Agent"] = "Blink/0.1 (NASA Space Apps 2026; SPHEREx flipbook)"
_adapter = requests.adapters.HTTPAdapter(pool_connections=32, pool_maxsize=32)
_session.mount("https://", _adapter)


class FetchError(RuntimeError):
    pass


def url_key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()


def cache_path(url: str, suffix: str = "", root: Path = HTTP_CACHE) -> Path:
    k = url_key(url)
    return root / k[:2] / (k + suffix)


def fetch(
    url: str,
    *,
    params: dict | None = None,
    expect: bytes | None = None,
    retries: int = 8,
    timeout: float = 180,
    cache: bool = True,
    suffix: str = "",
    validate=None,
) -> bytes:
    """GET `url` (with params) returning bytes. Retries on network errors, 5xx, 429 and IRSA's
    plain-text "Server busy" replies. `expect` = required prefix of a valid body.
    Successful bodies are cached on disk forever (data releases are immutable)."""
    full = requests.Request("GET", url, params=params).prepare().url
    path = cache_path(full, suffix)
    if cache and path.exists():
        return path.read_bytes()
    delay = 2.0
    last = None
    for attempt in range(retries):
        try:
            r = _session.get(full, timeout=timeout)
            body = r.content
            # 204 No Content is a valid, empty answer (e.g. SkyBoT: no objects in the cone)
            ok = r.status_code == 204 or (r.status_code == 200 and (expect is None or body.startswith(expect)))
            if ok and validate is not None and r.status_code != 204:
                ok = validate(body)
            if ok:
                if cache:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(path.suffix + f".tmp{random.randint(0, 1 << 30)}")
                    tmp.write_bytes(body)
                    tmp.replace(path)
                return body
            if r.status_code in (400, 404):
                raise FetchError(f"{r.status_code} for {full}: {body[:200]!r}")
            last = f"HTTP {r.status_code}: {body[:80]!r}"
        except (requests.RequestException, OSError) as e:  # network hiccup
            last = repr(e)
        sleep = delay * (1.6**attempt) * (0.7 + 0.6 * random.random())
        log.info("retry %d for %s (%s); sleeping %.1fs", attempt + 1, full[:120], last, sleep)
        time.sleep(min(sleep, 60))
    raise FetchError(f"gave up on {full}: {last}")
