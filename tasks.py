"""Cross-platform task runner (the Makefile calls this; on Windows run it directly).

    python tasks.py setup        # create .venv, install backend deps, install web deps
    python tasks.py prefetch     # download + precompute the five challenge targets
    python tasks.py refresh      # same, but re-query IRSA (new weekly QR3 data or a new release)
    python tasks.py export-web   # copy precomputed flipbooks into web/public/data (offline fallback)
    python tasks.py api          # run the FastAPI backend on :8787
    python tasks.py web          # run the Next.js dev server on :3100
    python tasks.py analyse      # motion analysis (+ ML candidates if a model exists) for the five targets
    python tasks.py ml           # fetch extra fields, build injections, train, evaluate, export ONNX, re-score
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
ENV = {**os.environ, "PYTHONUTF8": "1"}
TARGETS = ["barnards-star", "eps-indi-b", "wise-0855", "rw-aurigae", "r-draconis"]


def run(cmd, cwd=ROOT, **kw):
    print("$", " ".join(map(str, cmd)), flush=True)
    subprocess.run(list(map(str, cmd)), cwd=cwd, env=ENV, check=True, shell=(os.name == "nt" and cmd[0] == "pnpm"), **kw)


def setup():
    if not VENV_PY.exists():
        run([sys.executable, "-m", "venv", ROOT / ".venv"])
    run([VENV_PY, "-m", "pip", "install", "-r", ROOT / "backend" / "requirements.txt"])
    run(["pnpm", "install"], cwd=ROOT / "web")


def prefetch(refresh=False):
    run([VENV_PY, "scripts/prefetch.py", *(["--refresh"] if refresh else [])], cwd=ROOT / "backend")
    export_web()


def export_web():
    src = ROOT / "data" / "products"
    dst = ROOT / "web" / "public" / "data"
    for slug in TARGETS:
        (dst / slug).mkdir(parents=True, exist_ok=True)
        for f in (src / slug).glob("*.json"):
            if f.name.startswith(("flipbook_", "analysis", "candidates", "asteroids", "gaia")) and not f.name.startswith("flipbook_meta"):
                shutil.copy2(f, dst / slug / f.name)
    m = src / "ml_metrics.json"
    if m.exists():
        shutil.copy2(m, dst / "ml_metrics.json")
    print("exported web snapshots to", dst)


def analyse():
    run([VENV_PY, "scripts/analyse.py"], cwd=ROOT / "backend")
    export_web()


def ml():
    run([VENV_PY, "ml/fields.py"])
    run([VENV_PY, "ml/train.py", "all"])
    run([VENV_PY, "scripts/candidates.py"], cwd=ROOT / "backend")
    export_web()


def api():
    run([VENV_PY, "-m", "uvicorn", "blink.api:app", "--port", "8787"], cwd=ROOT / "backend")


def web():
    run(["pnpm", "exec", "next", "dev", "-p", "3100"], cwd=ROOT / "web")


if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else "help"
    {"setup": setup, "prefetch": prefetch, "analyse": analyse, "ml": ml, "refresh": lambda: prefetch(True), "export-web": export_web,
     "api": api, "web": web}.get(task, lambda: print(__doc__))()
