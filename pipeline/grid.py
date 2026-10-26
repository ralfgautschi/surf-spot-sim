"""Load the merged bathymetry grid and sample it."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator

ROOT = Path(__file__).resolve().parents[1]
BATHY = ROOT / "data" / "bathy.npz"

LAND = 1.0  # m above LAT used for cells without data (the DTM has no land values)


@dataclass
class Grid:
    x: np.ndarray
    y: np.ndarray
    z: np.ndarray  # elevation above LAT, NaN filled with LAND
    z0: float  # MSL - LAT (m)

    @property
    def dx(self) -> float:
        return float(self.x[1] - self.x[0])

    @classmethod
    def load(cls, path: Path = BATHY) -> "Grid":
        b = np.load(path)
        z = np.where(np.isfinite(b["z"]), b["z"], LAND).astype(float)
        return cls(b["x"], b["y"], z, float(b["z0"]))

    @classmethod
    def synthetic(cls, zfun, xmin=-5000, xmax=5000, ymin=-5000, ymax=500, dx=25.0, z0=2.0) -> "Grid":
        x = np.arange(xmin, xmax + dx, dx)
        y = np.arange(ymin, ymax + dx, dx)
        X, Y = np.meshgrid(x, y)
        return cls(x, y, zfun(X, Y).astype(float), z0)

    def smoothed(self, sigma_m: float) -> "Grid":
        return Grid(self.x, self.y, ndimage.gaussian_filter(self.z, sigma_m / self.dx), self.z0)

    def sampler(self):
        return RegularGridInterpolator((self.y, self.x), self.z, bounds_error=False, fill_value=np.nan)

    def depth_msl(self, tide: float = 0.0) -> np.ndarray:
        """Water depth (m, positive) for a sea level `tide` metres above MSL."""
        return self.z0 + tide - self.z
