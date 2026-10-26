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
