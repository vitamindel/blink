PY ?= python3

.PHONY: setup prefetch refresh export-web api web analyse ml

setup:        ## venv + backend deps + web deps
	$(PY) tasks.py setup

prefetch:     ## download + precompute the five challenge targets (uses caches)
	$(PY) tasks.py prefetch

refresh:      ## re-query IRSA for new data (weekly QR3, or a new release after editing backend/blink/config.py)
	$(PY) tasks.py refresh

export-web:   ## copy precomputed products into web/public/data (offline fallback)
	$(PY) tasks.py export-web

api:          ## FastAPI backend on :8787
	$(PY) tasks.py api

web:          ## Next.js dev server on :3100
	$(PY) tasks.py web

analyse:      ## proper motions, Gaia validation, light curves, ML candidates for the five targets
	$(PY) tasks.py analyse

ml:           ## extra fields + injection training set + CNN train/evaluate/export + re-score candidates
	$(PY) tasks.py ml
