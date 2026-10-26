"""Review figures for the pipeline outputs (written to docs/img/)."""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from grid import ROOT, Grid

IMG = ROOT / "docs" / "img"
COLORS = {"fortaleza": "#d95f02", "chico-times": "#1b9e77", "rocha-negra": "#7570b3"}


def _bathy(ax, g: Grid, xlim, ylim):
    zz = g.z
    m = ax.pcolormesh(g.x, g.y, np.where(zz > 0, np.nan, zz), cmap="Blues_r", vmin=-60, vmax=0, shading="auto")
    ax.pcolormesh(g.x, g.y, np.where(zz > 0, zz, np.nan), cmap="copper", vmin=0, vmax=120, shading="auto")
    cs = ax.contour(g.x, g.y, zz, levels=[-50, -30, -20, -10, -5, -2, 0], colors="k", linewidths=0.4)
    ax.clabel(cs, fontsize=6)
    ax.set_xlim(*xlim)
    ax.set_ylim(*ylim)
    ax.set_aspect(1)
    ax.set_xlabel("m east of origin")
    ax.set_ylabel("m north of origin")
    return m


def bathymetry_and_spots():
    g = Grid.load()
    spots = json.loads((ROOT / "data" / "spots.json").read_text())["spots"]
    fig = plt.figure(figsize=(16, 11))
    ax1 = fig.add_subplot(2, 2, 1)
    ax2 = fig.add_subplot(2, 2, 2)
    ax3 = fig.add_subplot(2, 1, 2)
    m = _bathy(ax1, g, (-30000, 9000), (-16000, 4000))
    ax1.set_title("Merged bathymetry (EMODnet DTM 2022 + 2011 LiDAR), m above LAT")
    _bathy(ax2, g, (-1500, 2000), (-1200, 700))
    ax2.set_title("Luz beach and spot pins")
    for sp in spots:
        c = COLORS.get(sp["id"], "k")
        f = np.radians(sp["facing"])
        for ax in (ax1, ax2):
            ax.plot(sp["x"], sp["y"], "o", color=c, mec="w", ms=8)
        ax2.annotate(sp["name"], (sp["x"], sp["y"]), xytext=(5, 8), textcoords="offset points", color=c, weight="bold")
        ax2.plot([sp["x"] - 200 * np.sin(f), sp["x"] + 1200 * np.sin(f)],
                 [sp["y"] - 200 * np.cos(f), sp["y"] + 1200 * np.cos(f)], "--", color=c, lw=1)
        p = sp["profile"]
        s = p["start"] + p["step"] * np.arange(len(p["zLAT"]))
        ax3.plot(s, p["zLAT"], color=c, label=f'{sp["name"]} (faces {sp["facing"]:.0f}°)')
    ax3.axhline(g.z0, color="grey", lw=0.8, ls=":")
    ax3.text(2400, g.z0 + 0.3, "MSL", color="grey", ha="right")
    ax3.axhline(0, color="grey", lw=0.8, ls=":")
    ax3.text(2400, 0.3, "LAT", color="grey", ha="right")
    ax3.set_xlim(-200, 2500)
    ax3.set_ylim(-30, 8)
    ax3.set_xlabel("distance seaward of take-off pin (m)")
    ax3.set_ylabel("seabed, m above LAT")
    ax3.set_title("Cross-shore profiles")
    ax3.legend()
    ax3.grid(alpha=0.3)
    fig.colorbar(m, ax=[ax1, ax2], shrink=0.7)
    IMG.mkdir(parents=True, exist_ok=True)
    fig.savefig(IMG / "bathymetry_spots.png", dpi=100, bbox_inches="tight")


def _load_rm(spot_id: str, T: int) -> dict:
    t = json.loads((ROOT / "web" / "public" / "data" / "transfer" / f"{spot_id}.json").read_text())
    p = next(p for p in t["periods"] if p["T"] == T)
    f = lambda a: np.array([np.nan if v is None else v for v in a], dtype=float)  # noqa: E731
    return {"local": f(p["local"]), "offshore": f(p["offshore"]), "ratio": f(p["ratio"])}


def transfer_and_rays():
    from raytrace import SpeedField, trace
    from transfer import apply, spread_deg

    g = Grid.load()
    spots = json.loads((ROOT / "web" / "public" / "data" / "spots.json").read_text())["spots"]
    fig, axs = plt.subplots(2, 2, figsize=(16, 12))
    dirs = np.arange(150, 300, 2.5)
    for ax, T in zip(axs[0], (8, 14)):
        for sp in spots:
            rm = _load_rm(sp["id"], T)
            K = [apply(rm, d, spread_deg(T))[0] for d in dirs]
            ax.plot(dirs, K, color=COLORS[sp["id"]], label=sp["name"])
        ax.set_title(f"Height factor at 10 m depth vs offshore swell direction, T={T} s")
        ax.set_xlabel("offshore swell direction (from, °)")
        ax.set_ylabel("Hs at spot / Hs offshore")
        ax.axvspan(255, 300, color="grey", alpha=0.1)
        ax.text(258, 0.05, "W–NW", color="grey")
        ax.grid(alpha=0.3)
        ax.legend()
    smooth = g.smoothed(75.0)
    for ax, (T, d) in zip(axs[1], ((12, 200), (14, 250))):
        _bathy(ax, g, (-6000, 8000), (-9000, 1500))
        f = SpeedField(float(T), smooth)
        for sp in spots:
            rm = _load_rm(sp["id"], T)
            # show only rays that carry this swell (offshore direction within ±20°)
            dd = (rm["offshore"] - d + 180) % 360 - 180
            sel = rm["local"][np.isfinite(dd) & (np.abs(dd) < 20)][::3]
            if sel.size:
                r = trace(f, sp["ref"]["x"], sp["ref"]["y"], sel, keep_path=True)
                for p in r["paths"]:
                    ax.plot(p[:, 0], p[:, 1], color=COLORS[sp["id"]], lw=0.6, alpha=0.8)
            ax.plot(sp["ref"]["x"], sp["ref"]["y"], "o", color=COLORS[sp["id"]], mec="w")
        ax.set_title(f"Rays feeding each spot from a {d}° swell, T={T} s")
    fig.savefig(IMG / "transfer_rays.png", dpi=90, bbox_inches="tight")


if __name__ == "__main__":
    bathymetry_and_spots()
    transfer_and_rays()
