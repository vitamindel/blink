"""Regenerate every figure and the numbers table used in paper/main.tex from Blink's data products.

    PYTHONUTF8=1 .venv/Scripts/python.exe paper/make_figures.py
"""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
P = ROOT / "data" / "products"
OUT = Path(__file__).resolve().parent / "figures"
OUT.mkdir(exist_ok=True)
TARGETS = ["barnards-star", "eps-indi-b", "wise-0855", "rw-aurigae", "r-draconis"]
NAMES = {"barnards-star": "Barnard's Star", "eps-indi-b": r"$\varepsilon$ Indi B", "wise-0855": "WISE 0855$-$0714",
         "rw-aurigae": "RW Aur", "r-draconis": "R Dra"}

# reference categorical palette (light mode), fixed order
C1, C2, C3 = "#2a78d6", "#eb6834", "#1baf7a"
INK, INK2, GRID = "#0b0b0b", "#52514e", "#d9d8d4"

plt.rcParams.update({
    "font.family": "serif", "font.size": 8.5, "axes.labelsize": 8.5, "axes.titlesize": 9,
    "legend.fontsize": 7.5, "xtick.labelsize": 7.5, "ytick.labelsize": 7.5,
    "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2, "ytick.color": INK2,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.5, "axes.axisbelow": True,
    "axes.spines.top": False, "axes.spines.right": False, "lines.linewidth": 1.6,
    "savefig.bbox": "tight", "savefig.dpi": 300, "pdf.fonttype": 42,
})


def load(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


m2 = load(P / "ml_metrics.json")
m1 = load(ROOT / "ml" / "models" / "ml_metrics_v1.json")


# ------------------------------------------------------------------ 1. ROC + PR, v1 vs v2
def fig_roc_pr():
    fig, ax = plt.subplots(1, 2, figsize=(6.6, 2.6))
    for m, c, lab in ((m1, C2, "v1"), (m2, C1, "v2")):
        r = np.array(m["roc"])
        ax[0].plot(r[:, 0], r[:, 1], color=c, label=f"{lab}  (AUC {m['roc_auc']:.2f})")
        pr = np.array(m["pr"])
        ax[1].plot(pr[:, 0], pr[:, 1], color=c, label=f"{lab}  (AP {m['average_precision']:.2f})")
    ax[0].plot([0, 1], [0, 1], color=GRID, lw=1, ls="--")
    ax[0].set(xlabel="False-positive rate", ylabel="True-positive rate", xlim=(0, 1), ylim=(0, 1.01),
              title="ROC, held-out fields")
    ax[1].set(xlabel="Recall", ylabel="Precision", xlim=(0, 1), ylim=(0.45, 1.01), title="Precision–recall")
    for a in ax:
        a.legend(loc="lower right", frameon=False)
    fig.savefig(OUT / "roc_pr.pdf")
    plt.close(fig)


# ------------------------------------------------------------------ 2. completeness grid
def fig_completeness():
    c = m2["completeness"]
    snr, disp = c["snr_bins"], c["disp_bins_px"]
    grid = c["grid"]
    ncol = max(j for row in grid for j, cell in enumerate(row) if cell["n"]) + 1
    R = np.array([[cell["recovered"] if cell["recovered"] is not None else np.nan for cell in row[:ncol]] for row in grid])
    N = np.array([[cell["n"] for cell in row[:ncol]] for row in grid])
    fig, ax = plt.subplots(figsize=(3.4, 2.9))
    ax.grid(False)
    im = ax.imshow(R, origin="lower", cmap="Blues", vmin=0, vmax=1, aspect="auto")
    for i in range(R.shape[0]):
        for j in range(R.shape[1]):
            if np.isfinite(R[i, j]):
                ax.text(j, i, f"{R[i, j]:.2f}\n(n={N[i, j]})", ha="center", va="center", fontsize=6,
                        color="white" if R[i, j] > 0.6 else INK)
    ax.set_xticks(np.arange(ncol + 1) - 0.5, [f"{d:g}" for d in disp[:ncol + 1]])
    ax.set_yticks(np.arange(len(snr)) - 0.5, [f"{s:g}" for s in snr])
    ax.set_xlabel("Displacement between epochs (px; 1 px = 6.15″)")
    ax.set_ylabel("Injected S/N (all detectors)")
    cb = fig.colorbar(im, ax=ax, fraction=0.05, pad=0.03)
    cb.set_label("Recovered fraction (p ≥ 0.5)")
    cb.outline.set_visible(False)
    fig.savefig(OUT / "completeness.pdf")
    plt.close(fig)


# ------------------------------------------------------------------ 3. training curves
def fig_training():
    fig, ax = plt.subplots(1, 2, figsize=(6.6, 2.3))
    for m, c, lab in ((m1, C2, "v1"), (m2, C1, "v2")):
        h = m["history"]
        e = [x["epoch"] for x in h]
        ax[0].plot(e, [x["val_loss"] for x in h], color=c, label=f"{lab} validation")
        ax[0].plot(e, [x["train_loss"] for x in h], color=c, ls=":", lw=1.2, label=f"{lab} train")
        ax[1].plot(e, [x["val_acc"] for x in h], color=c, label=lab)
    ax[0].set(xlabel="Epoch", ylabel="BCE loss", title="Loss")
    ax[1].set(xlabel="Epoch", ylabel="Accuracy", title="Validation accuracy (in-distribution)")
    ax[0].legend(frameon=False, ncol=2, loc="upper right", bbox_to_anchor=(1.0, 1.0), fontsize=6.5)
    ax[0].set_ylim(0.2, 0.85)
    ax[1].legend(frameon=False, loc="lower right")
    fig.savefig(OUT / "training.pdf")
    plt.close(fig)


# ------------------------------------------------------------------ 4. scores of real objects
def fig_real_scores():
    fig, ax = plt.subplots(1, 2, figsize=(6.6, 2.4), sharey=True)
    bins = np.linspace(0, 1, 26)
    for a, m, lab in ((ax[0], m1, "v1"), (ax[1], m2, "v2")):
        ro = m["real_objects"]
        stat = np.array([r["score"] for r in ro if r["kind"] == "gaia" and r["pm_mas_yr"] < 20])
        a.hist(stat, bins=bins, color=GRID, edgecolor="white", linewidth=0.6,
               label=f"static Gaia stars (n={len(stat)})")
        a.set_yscale("log")
        tg = [r for r in ro if r["kind"] == "target"]
        ymax = a.get_ylim()[1]
        for k, r in enumerate(tg):
            col = C1 if r["moving"] else C2
            a.axvline(r["score"], color=col, lw=1.4)
            name = {"Barnard's Star": "Barnard", "Epsilon Indi B": "ε Ind B", "WISE 0855−0714": "W0855",
                    "RW Aurigae": "RW Aur", "R Draconis": "R Dra"}.get(r["name"], r["name"])
            right = r["score"] >= 0.8
            a.text(r["score"], ymax * (0.55 ** (k + 1)), name + " " if right else " " + name, color=INK,
                   fontsize=6.5, ha="right" if right else "left")
        a.set(xlabel="CNN score", title=f"{lab}: real objects never trained on", xlim=(0, 1))
    ax[0].set_ylabel("Count")
    from matplotlib.lines import Line2D
    handles = [plt.Rectangle((0, 0), 1, 1, color=GRID), Line2D([], [], color=C1), Line2D([], [], color=C2)]
    fig.legend(handles, ["static Gaia stars", "known movers", "variable stars"], frameon=False,
               loc="lower center", ncol=3, bbox_to_anchor=(0.5, -0.02))
    fig.subplots_adjust(bottom=0.27)
    fig.savefig(OUT / "real_scores.pdf")
    plt.close(fig)


# ------------------------------------------------------------------ 5. proper motions vs Gaia
def fig_gaia():
    """Per-component residuals against Gaia DR3 (total PM is positive-definite and noise-biased, so it is not
    used for the comparison)."""
    fig, ax = plt.subplots(1, 2, figsize=(6.6, 2.6))
    snr, d, e, fast = [], [], [], []
    for t in TARGETS:
        a = load(P / t / "analysis.json")
        for s in a["sources"]:
            g = s.get("gaia")
            if not g or g.get("pmra") is None or "pmra" not in s or s.get("n_epochs", 0) < 3:
                continue
            for comp, gc, ec in (("pmra", "pmra", "epmra"), ("pmdec", "pmdec", "epmdec")):
                snr.append(s["snr"]), d.append(s[comp] - g[gc]), e.append(s[ec]), fast.append(g["pm"] > 1000)
    snr, d, e, fast = map(np.array, (snr, d, e, fast))
    ax[0].scatter(snr[~fast], d[~fast] / 1e3, s=5, color=C1, alpha=0.6, lw=0, label="field stars (μα*, μδ)")
    ax[0].scatter(snr[fast], d[fast] / 1e3, s=28, marker="D", color=C2, edgecolor="white", lw=0.8,
                  label="Barnard's Star, ε Indi B", zorder=3)
    ax[0].axhline(0, color=INK2, lw=0.8, ls="--")
    ax[0].set(xscale="log", xlabel="Detection S/N (deep stack)", ylabel=r"$\mu_\mathrm{SPHEREx}-\mu_\mathrm{Gaia}$ (″/yr)",
              ylim=(-1.5, 1.5), title=f"Proper-motion residuals ({len(d) // 2} sources)")
    ax[0].legend(frameon=False, loc="lower right")
    pull = d / e
    ok = np.isfinite(pull)
    ax[1].hist(np.clip(pull[ok], -4.9, 4.9), bins=np.linspace(-5, 5, 41), color=C1, edgecolor="white",
               linewidth=0.5, density=True, label="measured")
    xx = np.linspace(-5, 5, 200)
    ax[1].plot(xx, np.exp(-xx**2 / 2) / np.sqrt(2 * np.pi), color=INK, lw=1.2, label="N(0, 1)")
    ax[1].set(xlabel=r"$(\mu_\mathrm{SPHEREx}-\mu_\mathrm{Gaia})/\sigma_\mu$", ylabel="Density",
              title="Normalised residuals")
    ax[1].legend(frameon=False)
    fig.savefig(OUT / "gaia_pm.pdf")
    plt.close(fig)
    med = float(np.median(pull[ok]))
    nmad = float(1.4826 * np.median(np.abs(pull[ok] - med)))
    dmed = float(np.median(d))
    dnmad = float(1.4826 * np.median(np.abs(d - dmed)))
    return dict(n_sources=int(len(d) // 2), pull_median=med, pull_nmad=nmad, resid_median_mas=dmed,
                resid_nmad_mas=dnmad, frac_within_3sigma=float(np.mean(np.abs(pull[ok]) < 3)))


# ------------------------------------------------------------------ 6. CNN input stamps (real candidates)
def _stamp(slug, rank):
    c = load(P / slug / "candidates.json")
    for x in c["candidates"]:
        if x["rank"] == rank and "stamp" in x:
            return np.frombuffer(base64.b64decode(x["stamp"]), "<f4").reshape(6, 21, 21), x
    return None, None


def fig_stamps():
    # WISE 0855 ranks #2 in its field (rank 1 is an unrelated candidate); static example = a Gaia-static star
    rows = [("barnards-star", 1, "Barnard's Star"), ("eps-indi-b", 1, "ε Indi B"), ("wise-0855", 2, "WISE 0855")]
    c = load(P / "rw-aurigae" / "candidates.json")
    statics = [x for x in c["candidates"] if x.get("gaia_pm") is not None and x["gaia_pm"] < 10
               and (x.get("snr") or 0) > 30 and "stamp" in x]
    typical = sorted(statics, key=lambda x: x["score"])[len(statics) // 2]
    rows.append(("rw-aurigae", typical["rank"], "static star\n(typical)"))
    rows.append(("rw-aurigae", statics[0]["rank"], "static star\n(hardest)"))
    chans = ["A (D1–6)", "B (D1–6)", "B−A (D1–6)", "A (D4–6)", "B (D4–6)", "B−A (D4–6)"]
    fig, ax = plt.subplots(len(rows), 6, figsize=(6.6, 1.15 * len(rows) + 0.3))
    for i, (slug, rank, name) in enumerate(rows):
        S, info = _stamp(slug, rank)
        X = np.arcsinh(S / 3.0)
        for k in range(6):
            a = ax[i, k]
            a.grid(False)
            if k in (2, 5):
                v = max(np.abs(X[k]).max(), 1e-3)
                a.imshow(X[k], cmap="RdBu_r", vmin=-v, vmax=v, origin="lower")
            else:
                v = np.percentile(X[[0, 1, 3, 4]], 99.5)
                a.imshow(X[k], cmap="gray_r", vmin=-0.5, vmax=v, origin="lower")
            a.set_xticks([]), a.set_yticks([])
            for sp in a.spines.values():
                sp.set_visible(False)
            if i == 0:
                a.set_title(chans[k], fontsize=7)
        ax[i, 0].set_ylabel(f"{name}\np = {info['score']:.2f}", fontsize=7, rotation=0, ha="right", va="center",
                            labelpad=4)
    fig.subplots_adjust(wspace=0.04, hspace=0.06)
    fig.savefig(OUT / "stamps.pdf")
    plt.close(fig)


# ------------------------------------------------------------------ 7. ε Indi B spectrum + template fits
def fig_spectrum():
    s = next(load(f) for f in (P / "eps-indi-b" / "spec").glob("*.json"))
    sp = s["spectrum"]
    cl = s["classification"]
    lam = np.array([x["wave_um"] for x in sp])
    f = np.array([x["flux_ujy"] for x in sp]) / 1e3
    e = np.array([x["eflux_ujy"] for x in sp]) / 1e3
    fig, ax = plt.subplots(figsize=(6.6, 2.6))
    for lo, hi, lab in ((1.30, 1.50, "H$_2$O"), (1.80, 2.05, "H$_2$O"), (3.10, 3.70, "CH$_4$"), (1.58, 1.72, "CH$_4$")):
        ax.axvspan(lo, hi, color="#f1f0ec", lw=0, zorder=0)
        ax.text((lo + hi) / 2, 0.97, lab, transform=ax.get_xaxis_transform(), ha="center", va="top", fontsize=6.5,
                color=INK2)
    ax.errorbar(lam, f, yerr=e, fmt="o", ms=2.5, color=INK, ecolor="#9a998f", elinewidth=0.7, label="SPHEREx (102-channel binned)")
    styles = {"brown_dwarf": (C1, "-", f"brown dwarf {cl['best_templates']['brown_dwarf']}"),
              "star": (C2, "--", f"blackbody {cl['best_templates']['star']}"),
              "galaxy_qso": (C3, ":", f"power law {cl['best_templates']['galaxy_qso']}")}
    for fam, mod in cl["models"].items():
        if mod is None:
            continue
        y = np.array([np.nan if v is None else v for v in mod]) / 1e3
        col, ls, lab = styles[fam]
        lab += rf"  ($\chi^2_\nu$={cl['reduced_chi2'][fam]:.1f})"
        ax.plot(lam, y, color=col, ls=ls, lw=1.5, label=lab)
    ax.set(xlabel="Wavelength (µm)", ylabel=r"$f_\nu$ (mJy)", xlim=(0.7, 5.05),
           title=r"$\varepsilon$ Indi B: forced ePSF photometry in %d exposures" % s["n_exposures"])
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.2), ncol=2)
    fig.savefig(OUT / "spectrum_epsindib.pdf")
    plt.close(fig)


# ------------------------------------------------------------------ 8. motion composite (real data)
def fig_motion():
    from blink.config import FETCH_FOV_DEG
    from blink.stack import Stack, stack_path
    from blink.stamps import RED, Field
    from blink.targets import TEST_TARGETS
    from blink.candidates import best_pair

    fig, ax = plt.subplots(1, 3, figsize=(6.6, 2.35))
    for a, slug in zip(ax, ["barnards-star", "eps-indi-b", "wise-0855"]):
        st = Stack.load(stack_path(slug, FETCH_FOV_DEG))
        f = Field(st)
        ea, eb = best_pair(f)
        A, B = f.epochs[ea], f.epochs[eb]
        dets = [d for d in RED if d in A.img and d in B.img]
        sa = f.snr_combine(A.img, A.var, dets)
        sb = f.snr_combine(B.img, B.var, dets)
        t = TEST_TARGETS[slug]
        x, y = st.wcs.all_world2pix(*t.at((A.year + B.year) / 2), 0)
        h = 22
        sl = (slice(int(y) - h, int(y) + h + 1), slice(int(x) - h, int(x) + h + 1))
        sa, sb = np.nan_to_num(sa[sl]), np.nan_to_num(sb[sl])

        def norm(v):
            return np.clip(np.arcsinh(np.clip(v, 0, None) / 3) / np.arcsinh(60 / 3), 0, 1)

        na, nb = norm(sa), norm(sb)
        # A in blue, B in orange: the two sum to (near) white, so static stars are neutral
        ca, cb = np.array([0.16, 0.47, 0.84]), np.array([0.92, 0.41, 0.20])
        ca, cb = ca / (ca + cb), cb / (ca + cb)
        rgb = 1 - np.clip(na[..., None] * ca + nb[..., None] * cb, 0, 1)  # inverted for print: white background
        a.imshow(rgb, origin="lower", extent=[-h - .5, h + .5, -h - .5, h + .5])
        a.grid(False)
        a.set_xticks([]), a.set_yticks([])
        a.set_title(f"{NAMES[slug]}\n{A.year:.2f} → {B.year:.2f}", fontsize=7.5)
        a.plot([h - 9.76, h - 1.6], [-h + 2, -h + 2], color=INK, lw=1.2)  # 1′ = 9.76 px
        a.text(h - 5.7, -h + 3.2, "1′", ha="center", fontsize=6.5)
    fig.savefig(OUT / "motion.pdf")
    plt.close(fig)


# ------------------------------------------------------------------ numbers for the tables
def numbers(gaia_stats):
    from blink.targets import TEST_TARGETS

    rows = []
    for t in TARGETS:
        a = load(P / t / "analysis.json")
        c = load(P / t / "candidates.json")
        n_exp = sum(e["n_exposures"] for e in a["epochs"])
        mv = [s for s in a["sources"] if s["id"] in a["movers"]]
        tgt = TEST_TARGETS[t]
        rec = dict(slug=t, epochs=len(a["epochs"]), exposures_in_epochs=n_exp, sources=len(a["sources"]),
                   measured=a.get("n_measured"), gaia_n=a["gaia_comparison"].get("n"),
                   gaia_scatter=a["gaia_comparison"].get("robust_scatter_mas_yr"),
                   n_candidates=len(c["candidates"]), n_above_09=sum(x["score"] >= 0.9 for x in c["candidates"]),
                   pair=c["pair"], catalog_pm=float(np.hypot(tgt.pmra, tgt.pmdec)))
        if mv:
            s = mv[0]
            rec.update(pm=s["pm"], epm=s["epm"], pm_sig=s["pm_sig"], gaia_pm=(s.get("gaia") or {}).get("pm"))
        rows.append(rec)
    out = dict(targets=rows, gaia=gaia_stats,
               static_fp_05=float(np.mean([r["score"] >= 0.5 for r in m2["real_objects"]
                                           if r["kind"] == "gaia" and r["pm_mas_yr"] < 20])))
    (OUT / "numbers.json").write_text(json.dumps(out, indent=1))
    for r in rows:
        print(r)
    print(gaia_stats, out["static_fp_05"])


if __name__ == "__main__":
    fig_roc_pr()
    fig_completeness()
    fig_training()
    fig_real_scores()
    g = fig_gaia()
    fig_stamps()
    fig_spectrum()
    numbers(g)
    fig_motion()
    print("figures in", OUT)
