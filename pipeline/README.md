# Pipeline

Offline Python steps that turn public bathymetry into per-spot tables the web app loads.

1. Download the inputs (not committed; ~2 GB) into `data/raw/`:
   - `curl -O https://downloads.emodnet-bathymetry.eu/high_resolution/590_HR_Lidar_Algarve.emo.zip` then unzip `590_HR_Lidar_Algarve.nc`
   - `curl -o dtm/F3.zip https://downloads.emodnet-bathymetry.eu/v11/F3_2022.nc.zip` then unzip into `data/raw/dtm/`
   (EMODnet DTM tiles: letter = latitude band from the north, number = longitude band from the west.)
2. `python bathymetry.py` → `data/bathy.npz` (25 m local grid, metres above LAT)
3. `python spots.py` → `data/spots.json` (from the pins in `data/spots.seed.json`)
4. `python plots.py` → review figures in `docs/img/`

Vertical datum: both inputs are relative to LAT. `Z0_LAT_BELOW_MSL` (2.0 m, assumed for Lagos) converts to the
mean-sea-level tide that Open-Meteo reports.
5. `python build_tables.py` → `web/public/data/` (spots, per-spot transfer tables, cropped bay grid)
6. `python -m pytest pipeline/tests`

## Method
Backward ray tracing (`raytrace.py`, RK2 in arc length over a 75 m-smoothed seabed) from a reference point at 10 m
depth on each spot's profile. For every period (5–22 s) a fan of local arrival directions (facing ±89°) is traced
seaward; each ray ends offshore (depth ≥ 70 m or grid edge) or on land. Since E(f,θ)·c·cg is conserved along rays,
the height factor for an offshore partition is K² = Σ D(θ_off) · (c·cg)_off/(c·cg)_ref · Δθ (`transfer.apply`).

Known limitation: ray theory has no diffraction, so swell from directions fully shadowed by the Sagres peninsula
(W–NW) gives K≈0; in reality a small fraction leaks around the headland. Calibrate against observations.
