"""Build per-spot transfer tables and the bay grid the web app loads.

Writes:
  web/public/data/spots.json        spot geometry + reference point
  web/public/data/transfer/<id>.json ray maps per period
  web/public/data/bay.json + bay.bin cropped bathymetry (int16 decimetres above LAT) for the bay view
"""
from __future__ import annotations

import json

import numpy as np

from grid import ROOT, Grid
from raytrace import SpeedField
from transfer import PERIODS, REF_DEPTH, ray_map, reference_point

OUT = ROOT / "web" / "public" / "data"
RAY_SMOOTHING = 75.0  # m, Gaussian smoothing of the seabed before tracing
BAY = dict(xmin=-4000, xmax=7000, ymin=-8000, ymax=1500)


def _r(a, nd=1):
    return [None if not np.isfinite(v) else round(float(v), nd) for v in a]


def build_transfer(grid: Grid, spots: dict) -> None:
    smooth = grid.smoothed(RAY_SMOOTHING)
    fields = {T: SpeedField(float(T), smooth) for T in PERIODS}
    (OUT / "transfer").mkdir(parents=True, exist_ok=True)
    for sp in spots["spots"]:
        x, y, s = reference_point(sp, grid.z0)
        sp["ref"] = {"x": round(x, 1), "y": round(y, 1), "s": s, "depth": REF_DEPTH}
        table = {"id": sp["id"], "ref": sp["ref"], "periods": []}
        for T in PERIODS:
            rm = ray_map(smooth, x, y, sp["facing"], float(T), fields[T])
            table["periods"].append({
                "T": int(T),
                "local": _r(rm["local"], 0),
                "offshore": _r(rm["offshore"], 1),
                "ratio": _r(rm["ratio"], 3),
            })
        (OUT / "transfer" / f'{sp["id"]}.json').write_text(json.dumps(table, separators=(",", ":")))
        print(f'{sp["name"]:12s} ref point at s={s:.0f} m, {REF_DEPTH:.0f} m deep')


def build_bay(grid: Grid) -> None:
    ix = (grid.x >= BAY["xmin"]) & (grid.x <= BAY["xmax"])
    iy = (grid.y >= BAY["ymin"]) & (grid.y <= BAY["ymax"])
    z = grid.z[np.ix_(iy, ix)]
    q = np.clip(np.round(z * 10), -32000, 32000).astype("<i2")
    (OUT / "bay.bin").write_bytes(q.tobytes())
    meta = {"x0": float(grid.x[ix][0]), "y0": float(grid.y[iy][0]), "dx": grid.dx,
            "nx": int(ix.sum()), "ny": int(iy.sum()), "scale": 0.1, "z0": grid.z0,
            "note": "int16 little-endian, row-major from south-west, value*scale = m above LAT"}
    (OUT / "bay.json").write_text(json.dumps(meta))


def main():
    grid = Grid.load()
    spots = json.loads((ROOT / "data" / "spots.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    build_transfer(grid, spots)
    build_bay(grid)
    (OUT / "spots.json").write_text(json.dumps(spots, separators=(",", ":")))


if __name__ == "__main__":
    main()
