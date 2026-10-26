"""Derive spot geometry (facing direction, cross-shore depth profile) from the pins.

Reads data/spots.seed.json, writes data/spots.json.
Directions are nautical: degrees clockwise from north. `facing` is the direction
the spot looks out to sea (the downslope direction of the smoothed seabed).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from bathymetry import to_local, to_latlon
from grid import ROOT, Grid

PROFILE_LEN = 2500.0  # m seaward of the take-off
PROFILE_BACK = 200.0  # m landward of the take-off
PROFILE_STEP = 5.0  # m


def bearing(dx: float, dy: float) -> float:
    return float(np.degrees(np.arctan2(dx, dy)) % 360)


def spot_geometry(grid: Grid, lat: float, lon: float) -> dict:
    x0, y0 = (float(v) for v in to_local(lat, lon))
    smooth = grid.smoothed(150.0)
    gy, gx = np.gradient(smooth.z, grid.dx)
    j = int(np.argmin(abs(grid.x - x0)))
    i = int(np.argmin(abs(grid.y - y0)))
    # downslope = -gradient
    ux, uy = -gx[i, j], -gy[i, j]
    n = np.hypot(ux, uy)
    ux, uy = ux / n, uy / n

    s = np.arange(-PROFILE_BACK, PROFILE_LEN + PROFILE_STEP, PROFILE_STEP)
    px, py = x0 + s * ux, y0 + s * uy
    z = grid.sampler()(np.stack([py, px], axis=-1))
    end_lat, end_lon = to_latlon(px[-1], py[-1])
    return {
        "x": round(x0, 1),
        "y": round(y0, 1),
        "facing": round(bearing(ux, uy), 1),
        "takeoffDepthLAT": round(float(-grid.sampler()([[y0, x0]])[0]), 2),
        "profile": {
            "step": PROFILE_STEP,
            "start": -PROFILE_BACK,
            "end": {"lat": round(float(end_lat), 5), "lon": round(float(end_lon), 5)},
            "zLAT": [round(float(v), 2) for v in z],
        },
    }


def main():
    seed = json.loads((ROOT / "data" / "spots.seed.json").read_text())
    grid = Grid.load()
    out = {"origin": {"lat": 37.085, "lon": -8.725}, "z0": grid.z0, "spots": []}
    for sp in seed["spots"]:
        geo = spot_geometry(grid, sp["takeoff"]["lat"], sp["takeoff"]["lon"])
        out["spots"].append({**sp, **geo})
        print(f'{sp["name"]:12s} facing {geo["facing"]:6.1f}  take-off depth {geo["takeoffDepthLAT"]:.1f} m below LAT')
    (ROOT / "data" / "spots.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
