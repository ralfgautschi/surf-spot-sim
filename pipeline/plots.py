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
    m = _bathy(ax1, g, (-14000, 9000), (-12000, 2500))
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


if __name__ == "__main__":
    bathymetry_and_spots()
