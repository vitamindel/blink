"""Train, evaluate and export the Blink mover CNN (real/bogus classifier on A/B/B−A stamp triplets).

    python ml/train.py build      # build injection datasets from cached SPHEREx stacks -> ml/data/*.npz
    python ml/train.py train      # train the CNN -> ml/models/mover.pt
    python ml/train.py evaluate   # metrics on held-out FIELDS + real movers -> data/products/ml_metrics.json
    python ml/train.py export     # ONNX -> ml/models/mover.onnx and web/public/models/mover.onnx
    python ml/train.py all
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "ml"))

from fields import TEST_FIELDS, TRAIN_FIELDS  # noqa: E402
from inject import STAMP, Field, make_samples  # noqa: E402

DATA = ROOT / "ml" / "data"
MODELS = ROOT / "ml" / "models"
PRODUCTS = ROOT / "data" / "products"
DATA.mkdir(parents=True, exist_ok=True)
MODELS.mkdir(parents=True, exist_ok=True)
TARGET_SLUGS = ["barnards-star", "eps-indi-b", "wise-0855", "rw-aurigae", "r-draconis"]
SEED = 20261114


def _load_field(slug: str):
    from blink.config import FETCH_FOV_DEG
    from blink.stack import Stack, stack_path
    from blink.targets import TEST_TARGETS

    p = stack_path(slug, FETCH_FOV_DEG)
    if not p.exists():
        return None
    st = Stack.load(p)
    exclude = []
    if slug in TEST_TARGETS:  # mask the target's whole track (and its catalogue position)
        t = TEST_TARGETS[slug]
        for yr in np.linspace(2025.0, 2027.0, 9):
            exclude.append(t.at(yr))
    a = PRODUCTS / slug / "analysis.json"
    if a.exists():  # mask every significant real mover too: real movers are test-only
        an = json.loads(a.read_text())
        ids = set(an.get("movers", [])) | set(an.get("rejected_by_gaia", []))
        for s in an["sources"]:
            if s["id"] in ids or (s.get("gaia") and (s["gaia"].get("pm") or 0) > 300):
                exclude.append((s["ra"], s["dec"]))
    return Field(st, exclude)


def build():
    rng = np.random.default_rng(SEED)
    from blink.stack import stack_path

    train_slugs = TARGET_SLUGS + [s for s, *_ in TRAIN_FIELDS if s not in TEST_FIELDS and stack_path(s, 0.2).exists()]
    test_slugs = [s for s, *_ in TRAIN_FIELDS if s in TEST_FIELDS]
    for name, slugs, npos, nneg in (("train", train_slugs, 2000, 2000), ("test", test_slugs, 1200, 1200)):
        Xs, Ys, Ms = [], [], []
        for slug in slugs:
            t0 = time.time()
            f = _load_field(slug)
            if f is None:
                print(f"  skip {slug} (no stack cached)")
                continue
            X, Y, M = make_samples(f, npos, nneg, rng)
            for m in M:
                m["field"] = slug
            Xs.append(X)
            Ys.append(Y)
            Ms += M
            print(f"  {name}: {slug}: {len(Y)} samples ({int(Y.sum())} pos), {len(f.epochs)} epochs, {time.time()-t0:.0f}s",
                  flush=True)
        X = np.concatenate(Xs)
        Y = np.concatenate(Ys)
        np.savez_compressed(DATA / f"{name}.npz", X=X, y=Y)
        (DATA / f"{name}_meta.json").write_text(json.dumps(Ms))
        print(f"{name}: {X.shape}, positives {Y.mean():.2f}")


# ------------------------------------------------------------------------------------------- model
def make_model():
    import torch.nn as nn

    class MoverNet(nn.Module):
        """Small real/bogus CNN in the spirit of ZTF's braai: 6×21×21 → P(real mover)."""

        def __init__(self):
            super().__init__()
            self.f = nn.Sequential(
                nn.Conv2d(6, 24, 3, padding=1), nn.BatchNorm2d(24), nn.ReLU(),
                nn.Conv2d(24, 24, 3, padding=1), nn.BatchNorm2d(24), nn.ReLU(),
                nn.MaxPool2d(2),  # 10
                nn.Conv2d(24, 48, 3, padding=1), nn.BatchNorm2d(48), nn.ReLU(),
                nn.Conv2d(48, 48, 3, padding=1), nn.BatchNorm2d(48), nn.ReLU(),
                nn.MaxPool2d(2),  # 5
                nn.Conv2d(48, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
                nn.AdaptiveAvgPool2d(1),
            )
            self.head = nn.Sequential(nn.Flatten(), nn.Dropout(0.3), nn.Linear(64, 32), nn.ReLU(), nn.Linear(32, 1))

        def forward(self, x):
            return self.head(self.f(x))

    return MoverNet()


def preprocess(X):
    """Compress dynamic range (bright stars reach S/N ~1000): asinh(x/3)."""
    return np.arcsinh(X / 3.0).astype(np.float32)


def augment(xb, rng):
    k = rng.integers(4)
    xb = np.rot90(xb, k, axes=(2, 3))
    if rng.random() < 0.5:
        xb = xb[:, :, :, ::-1]
    return np.ascontiguousarray(xb)


def train(epochs: int = 16):
    import torch

    torch.manual_seed(SEED)
    torch.set_num_threads(12)
    rng = np.random.default_rng(SEED)
    d = np.load(DATA / "train.npz")
    X, Y = preprocess(d["X"]), d["y"]
    perm = rng.permutation(len(Y))
    nval = len(Y) // 10
    vi, ti = perm[:nval], perm[nval:]
    model = make_model()
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=3e-3, total_steps=epochs * (len(ti) // 256 + 1))
    lossf = torch.nn.BCEWithLogitsLoss()
    best, hist = 1e9, []
    for ep in range(epochs):
        model.train()
        rng.shuffle(ti)
        tl = 0.0
        for k in range(0, len(ti), 256):
            b = ti[k:k + 256]
            xb = torch.from_numpy(augment(X[b], rng))
            yb = torch.from_numpy(Y[b]).unsqueeze(1)
            opt.zero_grad()
            loss = lossf(model(xb), yb)
            loss.backward()
            opt.step()
            sched.step()
            tl += loss.item() * len(b)
        model.eval()
        with torch.no_grad():
            pv = torch.sigmoid(model(torch.from_numpy(X[vi]))).numpy().ravel()
        vl = float(-np.mean(Y[vi] * np.log(pv + 1e-7) + (1 - Y[vi]) * np.log(1 - pv + 1e-7)))
        acc = float(np.mean((pv > 0.5) == Y[vi]))
        hist.append(dict(epoch=ep + 1, train_loss=tl / len(ti), val_loss=vl, val_acc=acc))
        print(f"epoch {ep+1:2d}  train {tl/len(ti):.4f}  val {vl:.4f}  acc {acc:.4f}", flush=True)
        if vl < best:
            best = vl
            torch.save(model.state_dict(), MODELS / "mover.pt")
    (MODELS / "train_history.json").write_text(json.dumps(hist, indent=1))


def load_model():
    import torch

    m = make_model()
    m.load_state_dict(torch.load(MODELS / "mover.pt", map_location="cpu"))
    m.eval()
    return m


def predict(model, X):
    import torch

    out = []
    with torch.no_grad():
        for k in range(0, len(X), 512):
            out.append(torch.sigmoid(model(torch.from_numpy(preprocess(X[k:k + 512])))).numpy().ravel())
    return np.concatenate(out) if out else np.zeros(0)


def real_movers_test(model):
    """Real objects (never trained on): known movers should score high, static Gaia stars and variables low."""
    from blink.catalogs import propagate
    from blink.targets import TEST_TARGETS

    rows = []
    for slug in TARGET_SLUGS + [s for s, *_ in TRAIN_FIELDS]:
        f = _load_field(slug)
        if f is None or len(f.epochs) < 2:
            continue
        a, b = 0, len(f.epochs) - 1  # longest baseline
        ya, yb = f.epochs[a].year, f.epochs[b].year
        w = f.st.wcs

        def mid_xy(ra, dec, pmra, pmdec, ref):
            r0, d0 = propagate(ra, dec, pmra, pmdec, ref, ya)
            r1, d1 = propagate(ra, dec, pmra, pmdec, ref, yb)
            x0, y0 = w.all_world2pix(r0, d0, 0)
            x1, y1 = w.all_world2pix(r1, d1, 0)
            return (float(x0) + float(x1)) / 2, (float(y0) + float(y1)) / 2

        if slug in TEST_TARGETS:
            t = TEST_TARGETS[slug]
            x, y = mid_xy(t.ra, t.dec, t.pmra, t.pmdec, t.ref_epoch)
            s = f.stamp(a, b, x, y)
            if s is not None:
                pm = float(np.hypot(t.pmra, t.pmdec))
                rows.append(dict(field=slug, name=t.name, kind="target", pm_mas_yr=pm, moving=pm > 1000, x=s))
        an = PRODUCTS / slug / "analysis.json"
        if an.exists():
            for src in json.loads(an.read_text())["sources"]:
                g = src.get("gaia")
                if not g or g.get("pm") is None or src.get("saturated"):
                    continue
                if g["pm"] > 300 or (g["pm"] < 20 and src["snr"] > 8):
                    x, y = mid_xy(src["ra"], src["dec"], (g["pmra"] or 0), (g["pmdec"] or 0), src.get("t_ref", 2026))
                    s = f.stamp(a, b, x, y)
                    if s is not None:
                        rows.append(dict(field=slug, name=f"Gaia {g['source_id']}", kind="gaia", pm_mas_yr=g["pm"],
                                         moving=g["pm"] > 1000, g=g["g"], x=s))
    if not rows:
        return []
    p = predict(model, np.stack([r.pop("x") for r in rows]))
    for r, s in zip(rows, p):
        r["score"] = float(s)
    return rows


def evaluate():
    from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve

    model = load_model()
    d = np.load(DATA / "test.npz")
    meta = json.loads((DATA / "test_meta.json").read_text())
    X, Y = d["X"], d["y"]
    p = predict(model, X)
    fpr, tpr, _ = roc_curve(Y, p)
    prec, rec, thr_pr = precision_recall_curve(Y, p)
    auc = float(roc_auc_score(Y, p))
    ap = float(average_precision_score(Y, p))
    thr = 0.5
    tp = int(((p >= thr) & (Y == 1)).sum())
    fp = int(((p >= thr) & (Y == 0)).sum())
    fn = int(((p < thr) & (Y == 1)).sum())
    # per negative type false-positive rate
    neg_types = {}
    for m, s, y in zip(meta, p, Y):
        if y == 0:
            neg_types.setdefault(m["type"], []).append(s >= thr)
    # completeness map (injected movers in held-out fields)
    snr_bins = [3, 5, 8, 12, 20, 40, 100, 400]
    spd_bins = [0.35, 0.6, 1.0, 1.5, 2.5, 4.0, 8.0]  # displacement between the two epochs, pixels
    grid = []
    pos = [(m, s) for m, s, y in zip(meta, p, Y) if y == 1]
    for i in range(len(snr_bins) - 1):
        row = []
        for j in range(len(spd_bins) - 1):
            sel = [s for m, s in pos if snr_bins[i] <= m["snr"] < snr_bins[i + 1] and spd_bins[j] <= m["disp_px"] < spd_bins[j + 1]]
            row.append(dict(n=len(sel), recovered=float(np.mean(np.array(sel) >= thr)) if sel else None))
        grid.append(row)
    by_spec = {k: float(np.mean([s >= thr for m, s in pos if m["spectrum"] == k])) for k in ("flat", "red", "blue")}
    real = real_movers_test(model)
    hist = json.loads((MODELS / "train_history.json").read_text())
    n_params = sum(p_.numel() for p_ in model.parameters())
    dtrain = np.load(DATA / "train.npz")["y"]

    def thin(a, b, k=120):
        idx = np.unique(np.linspace(0, len(a) - 1, min(k, len(a))).astype(int))
        return [[float(a[i]), float(b[i])] for i in idx]

    metrics = dict(
        model=dict(name="MoverNet", params=int(n_params), input=f"6×{STAMP}×{STAMP} (A, B, B−A for D1–D6 and D4–D6, S/N units)"),
        data=dict(train_samples=int(len(dtrain)), train_positive_frac=float(dtrain.mean()), test_samples=int(len(Y)),
                  train_fields=TARGET_SLUGS + [s for s, *_ in TRAIN_FIELDS if s not in TEST_FIELDS],
                  test_fields=sorted(TEST_FIELDS)),
        roc_auc=auc, average_precision=ap, threshold=thr,
        precision=tp / max(tp + fp, 1), recall=tp / max(tp + fn, 1), tp=tp, fp=fp, fn=fn,
        roc=thin(fpr, tpr), pr=thin(rec, prec),
        fp_rate_by_negative_type={k: float(np.mean(v)) for k, v in neg_types.items()},
        recall_by_spectrum=by_spec,
        completeness=dict(snr_bins=snr_bins, disp_bins_px=spd_bins, grid=grid,
                          note="displacement between the two epochs; 1 px = 6.15″ (≈6″/yr over a 1-yr baseline)"),
        real_objects=real,
        history=hist,
    )
    PRODUCTS.mkdir(parents=True, exist_ok=True)
    (PRODUCTS / "ml_metrics.json").write_text(json.dumps(metrics, indent=1))
    web = ROOT / "web" / "public" / "data"
    web.mkdir(parents=True, exist_ok=True)
    (web / "ml_metrics.json").write_text(json.dumps(metrics))
    print(f"AUC {auc:.4f}  AP {ap:.4f}  precision {metrics['precision']:.3f}  recall {metrics['recall']:.3f}")
    print("FP by negative type:", metrics["fp_rate_by_negative_type"])
    print("recall by spectrum:", by_spec)
    for r in real:
        if r["kind"] == "target" or r["moving"]:
            print(f"  real: {r['name']:<28} pm={r['pm_mas_yr']:7.0f} mas/yr  score={r['score']:.3f}")
    stat = [r["score"] for r in real if r["kind"] == "gaia" and r["pm_mas_yr"] < 20]
    if stat:
        print(f"  real static Gaia stars: n={len(stat)}  FP rate @0.5 = {np.mean(np.array(stat) >= thr):.4f}")


def export():
    import shutil

    import torch

    model = load_model()
    dummy = torch.zeros(1, 6, STAMP, STAMP)
    out = MODELS / "mover.onnx"
    torch.onnx.export(model, dummy, str(out), input_names=["stamps"], output_names=["logit"],
                      dynamic_axes={"stamps": {0: "n"}, "logit": {0: "n"}}, opset_version=17, dynamo=False)
    import onnxruntime as ort

    sess = ort.InferenceSession(str(out))
    x = np.random.default_rng(0).normal(size=(4, 6, STAMP, STAMP)).astype(np.float32)
    with torch.no_grad():
        ref = model(torch.from_numpy(x)).numpy()
    got = sess.run(None, {"stamps": x})[0]
    print("ONNX max |Δ| vs torch:", float(np.abs(ref - got).max()))
    dst = ROOT / "web" / "public" / "models"
    dst.mkdir(parents=True, exist_ok=True)
    shutil.copy2(out, dst / "mover.onnx")
    print("exported", out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd in ("build", "all"):
        build()
    if cmd in ("train", "all"):
        train()
    if cmd in ("evaluate", "all"):
        evaluate()
    if cmd in ("export", "all"):
        export()
