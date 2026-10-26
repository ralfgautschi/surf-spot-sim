"""Build a merged bathymetry grid for the Luz bay.

Inputs (EMODnet, CC-BY 4.0), both referenced to Lowest Astronomical Tide (LAT):
  - 590_HR_Lidar_Algarve.nc : 2011 coastal LiDAR, ~14 m, nearshore to ~-17 m
  - F3_2022.nc              : EMODnet DTM 2022 tile, ~115 m, the wider shelf

Output: data/bathy.npz with a regular local grid in metres
  x (east), y (north) relative to ORIGIN, z = elevation above LAT (negative = seabed).
"""
from __future__ import annotations

import argparse
from pathlib import Path

import netCDF4 as nc
import numpy as np
from scipy import ndimage
from scipy.interpolate import RegularGridInterpolator

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"

ORIGIN = (37.085, -8.725)  # lat, lon of the local grid origin (Luz beach)
Z0_LAT_BELOW_MSL = 2.0  # m; assumed MSL - LAT offset at Lagos, used by the simulation
EXTENT = dict(xmin=-14_000, xmax=9_000, ymin=-12_000, ymax=2_500)  # m
DX = 25.0  # m

M_PER_DEG_LAT = 111_320.0


def m_per_deg_lon(lat: float = ORIGIN[0]) -> float:
    return M_PER_DEG_LAT * np.cos(np.radians(lat))


def to_local(lat, lon):
    return (np.asarray(lon) - ORIGIN[1]) * m_per_deg_lon(), (np.asarray(lat) - ORIGIN[0]) * M_PER_DEG_LAT


def to_latlon(x, y):
    return ORIGIN[0] + np.asarray(y) / M_PER_DEG_LAT, ORIGIN[1] + np.asarray(x) / m_per_deg_lon()


def _read_crop(path: Path, pad_deg: float = 0.02):
    lat0, lon0 = to_latlon(EXTENT["xmin"], EXTENT["ymin"])
    lat1, lon1 = to_latlon(EXTENT["xmax"], EXTENT["ymax"])
    with nc.Dataset(path) as d:
        lat, lon = d["lat"][:], d["lon"][:]
        ia = np.where((lat >= lat0 - pad_deg) & (lat <= lat1 + pad_deg))[0]
        io = np.where((lon >= lon0 - pad_deg) & (lon <= lon1 + pad_deg))[0]
        z = d["elevation"][ia.min(): ia.max() + 1, io.min(): io.max() + 1]
    return np.asarray(lat[ia]), np.asarray(lon[io]), np.ma.filled(z.astype(float), np.nan)


def _sample(lat, lon, z, X, Y):
    la, lo = to_latlon(X, Y)
    f = RegularGridInterpolator((lat, lon), z, bounds_error=False, fill_value=np.nan)
    return f(np.stack([la.ravel(), lo.ravel()], axis=-1)).reshape(X.shape)


def build(dtm_path: Path, lidar_path: Path, out: Path) -> dict:
    x = np.arange(EXTENT["xmin"], EXTENT["xmax"] + DX, DX)
    y = np.arange(EXTENT["ymin"], EXTENT["ymax"] + DX, DX)
    X, Y = np.meshgrid(x, y)

    z_dtm = _sample(*_read_crop(dtm_path), X, Y)
    z_lid = _sample(*_read_crop(lidar_path), X, Y)

    # Feather the LiDAR into the DTM over ~150 m from the LiDAR edge so rays see no step.
    has_lid = np.isfinite(z_lid)
    dist_in = ndimage.distance_transform_edt(has_lid) * DX
    w = np.clip(dist_in / 150.0, 0, 1)
    z = np.where(has_lid, w * z_lid + (1 - w) * np.nan_to_num(z_dtm, nan=0.0), z_dtm)
    z = np.where(has_lid & ~np.isfinite(z_dtm), z_lid, z)

    np.savez_compressed(out, x=x, y=y, z=z.astype(np.float32), lidar=has_lid,
                        origin=np.array(ORIGIN), z0=Z0_LAT_BELOW_MSL)
    both = has_lid & np.isfinite(z_dtm)
    return {
        "shape": z.shape,
        "nan_frac": float(np.isnan(z).mean()),
        "lidar_frac": float(has_lid.mean()),
        "lidar_minus_dtm_median": float(np.median(z_lid[both] - z_dtm[both])) if both.any() else None,
        "z_range": (float(np.nanmin(z)), float(np.nanmax(z))),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dtm", type=Path, default=RAW / "dtm" / "F3_2022.nc")
    p.add_argument("--lidar", type=Path, default=RAW / "590_HR_Lidar_Algarve.nc")
    p.add_argument("--out", type=Path, default=ROOT / "data" / "bathy.npz")
    a = p.parse_args()
    print(build(a.dtm, a.lidar, a.out))


if __name__ == "__main__":
    main()
