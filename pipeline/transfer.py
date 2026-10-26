"""Per-spot transfer tables from backward ray tracing, and the reference way of applying them.

For each spot a reference point is placed on its cross-shore profile at REF_DEPTH below MSL.
For each period T, a fan of rays is launched seaward from the reference point, one per local
arrival direction theta_l (the direction waves come *from*). Each ray ends offshore with the
offshore direction theta_o that feeds theta_l, or on land (that local direction gets no energy).

E(f, theta) * c * cg is conserved along rays (Longuet-Higgins 1957), so for an offshore
partition with directional distribution D(theta):
    K^2(T) = sum_l D(theta_o(l)) * (c cg)_off / (c cg)_ref * dtheta
and Hs_ref = K * Hs_off. The energy-weighted mean of theta_l is the local mean direction.
"""
from __future__ import annotations

import numpy as np

from raytrace import OFFSHORE, EDGE, SpeedField, trace

REF_DEPTH = 10.0  # m below MSL
PERIODS = np.arange(5, 23)  # s
FAN_HALF_WIDTH = 89  # degrees either side of the spot's facing direction
DTHETA = 1.0  # degrees


def reference_point(spot: dict, z0: float, ref_depth: float = REF_DEPTH) -> tuple[float, float, float]:
    """Point on the spot's profile where depth below MSL first reaches ref_depth. Returns (x, y, s)."""
    p = spot["profile"]
    z = np.asarray(p["zLAT"], dtype=float)
    s = p["start"] + p["step"] * np.arange(z.size)
    depth = z0 - z
    i = int(np.argmax((depth >= ref_depth) & (s > 0)))
    f = np.radians(spot["facing"])
    return spot["x"] + s[i] * np.sin(f), spot["y"] + s[i] * np.cos(f), float(s[i])


def ray_map(grid, x, y, facing: float, T: float, field: SpeedField | None = None) -> dict:
    field = field or SpeedField(T, grid)
    local = facing + np.arange(-FAN_HALF_WIDTH, FAN_HALF_WIDTH + DTHETA, DTHETA)
    r = trace(field, x, y, local % 360)
    ok = (r["status"] == OFFSHORE) | (r["status"] == EDGE)
    ccg_ref = float(field.ccg_at(np.array([x]), np.array([y]))[0])
    return {
        "local": local % 360,
        "offshore": np.where(ok, r["heading"], np.nan),
        "ratio": np.where(ok, r["ccg"] / ccg_ref, np.nan),
    }


def spread_deg(T: float, kind: str = "swell") -> float:
    """Directional spread (1-sigma, degrees) assumed for a partition."""
    if kind == "wind":
        return 30.0
    return float(np.clip(30.0 - 1.2 * T, 10.0, 25.0))


def directional(theta, mean, sigma):
    """Wrapped-normal directional distribution in rad^-1."""
    d = (np.asarray(theta) - mean + 180) % 360 - 180
    return np.exp(-0.5 * (d / sigma) ** 2) / (np.radians(sigma) * np.sqrt(2 * np.pi))


def apply(rm: dict, mean_dir: float, sigma: float) -> tuple[float, float]:
    """(K, local mean direction) for an offshore partition with the given mean direction and spread."""
    ok = np.isfinite(rm["offshore"])
    if not ok.any():
        return 0.0, float("nan")
    w = directional(rm["offshore"][ok], mean_dir, sigma) * rm["ratio"][ok] * np.radians(DTHETA)
    k2 = float(w.sum())
    if k2 <= 0:
        return 0.0, float("nan")
    a = np.radians(rm["local"][ok])
    mean_local = np.degrees(np.arctan2((w * np.sin(a)).sum(), (w * np.cos(a)).sum())) % 360
    return float(np.sqrt(k2)), float(mean_local)
