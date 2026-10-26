"""Wave ray tracing over the bathymetry grid.

Directions are nautical bearings (degrees clockwise from north). A ray's `heading` is the
direction it travels. Rays are reversible in a static medium, so a backward ray launched from
a spot with heading = the direction waves arrive *from* follows the same path as the forward ray
and ends with heading = the offshore direction those waves came from.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.interpolate import RegularGridInterpolator

from grid import Grid
from waves import celerity

OFFSHORE, LAND, EDGE = 1, 2, 3


@dataclass
class SpeedField:
    """Phase/group speed and its gradient for one wave period over a grid, at a given sea level."""

    T: float
    grid: Grid

    def __post_init__(self):
        g = self.grid
        self.depth = g.depth_msl()
        c, cg = celerity(self.T, np.maximum(self.depth, 0.05))
        cy, cx = np.gradient(c, g.dx)
        pts = (g.y, g.x)
        kw = dict(bounds_error=False, fill_value=np.nan)
        self._c = RegularGridInterpolator(pts, c, **kw)
        self._cx = RegularGridInterpolator(pts, cx, **kw)
        self._cy = RegularGridInterpolator(pts, cy, **kw)
        self._cg = RegularGridInterpolator(pts, cg, **kw)
        self._h = RegularGridInterpolator(pts, self.depth, **kw)

    def at(self, x, y):
        p = np.stack([y, x], axis=-1)
        return self._c(p), self._cx(p), self._cy(p)

    def depth_at(self, x, y):
        return self._h(np.stack([y, x], axis=-1))

    def ccg_at(self, x, y):
        p = np.stack([y, x], axis=-1)
        return self._c(p) * self._cg(p)


def _dheading(field: SpeedField, x, y, phi):
    """Ray curvature d(phi)/ds in rad/m (phi = bearing in radians)."""
    c, cx, cy = field.at(x, y)
    return -(cx * np.cos(phi) - cy * np.sin(phi)) / c


def trace(field: SpeedField, x0, y0, headings_deg, ds=10.0, max_len=40_000.0,
          offshore_depth=70.0, land_depth=0.5, keep_path=False):
    """Trace rays from (x0, y0) with the given initial headings.

    Returns dict with end heading (deg), status (OFFSHORE/LAND/EDGE), end position, end depth,
    c*cg at the end, and optionally the paths (list of (n,2) arrays).
    """
    phi = np.radians(np.asarray(headings_deg, dtype=float))
    n = phi.size
    x = np.full(n, float(x0)) if np.isscalar(x0) else np.asarray(x0, float).copy()
    y = np.full(n, float(y0)) if np.isscalar(y0) else np.asarray(y0, float).copy()
    status = np.zeros(n, dtype=int)
    paths = [[(xi, yi)] for xi, yi in zip(x, y)] if keep_path else None
    steps = int(max_len / ds)
    for _ in range(steps):
        act = status == 0
        if not act.any():
            break
        xa, ya, pa = x[act], y[act], phi[act]
        # midpoint (RK2) step in arc length
        k1 = _dheading(field, xa, ya, pa)
        xm = xa + 0.5 * ds * np.sin(pa)
        ym = ya + 0.5 * ds * np.cos(pa)
        k2 = _dheading(field, xm, ym, pa + 0.5 * ds * k1)
        pm = pa + 0.5 * ds * k1
        xn = xa + ds * np.sin(pm)
        yn = ya + ds * np.cos(pm)
        pn = pa + ds * np.where(np.isfinite(k2), k2, 0.0)
        h = field.depth_at(xn, yn)
        st = np.zeros(xa.size, dtype=int)
        st[~np.isfinite(h)] = EDGE
        st[np.isfinite(h) & (h < land_depth)] = LAND
        st[np.isfinite(h) & (h >= offshore_depth)] = OFFSHORE
        idx = np.where(act)[0]
        upd = st != EDGE  # keep the last in-grid position for rays leaving the grid
        x[idx[upd]], y[idx[upd]], phi[idx[upd]] = xn[upd], yn[upd], pn[upd]
        status[idx] = st
        if keep_path:
            for k, i in enumerate(idx):
                if upd[k]:
                    paths[i].append((xn[k], yn[k]))
    status[status == 0] = EDGE  # ran out of length: treat like the grid edge
    out = {
        "heading": np.degrees(phi) % 360,
        "status": status,
        "x": x,
        "y": y,
        "depth": field.depth_at(x, y),
        "ccg": field.ccg_at(x, y),
    }
    if keep_path:
        out["paths"] = [np.array(p) for p in paths]
    return out
