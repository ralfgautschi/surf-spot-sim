# surf-spot-sim

Per-spot wave simulation for Praia da Luz (Algarve): **Fortaleza**, **Chico Times** and **Rocha Negra**.
The offshore forecast is carried over the real seabed to each spot (ray tracing, shoaling, breaking) and animated.

- `pipeline/`: Python, builds the bathymetry grid and per-spot transfer tables (see `pipeline/README.md`)
- `web/`: Vite + Preact app: forecast → per-spot breaking waves, side-view and bay animations
- `docs/PLAN.md`: project plan; `docs/img/`: review figures

## Run
```
cd web && npm install && npm run dev      # app
npm test                                 # simulation tests (vitest)
python -m pytest pipeline/tests          # physics tests
```
What-if scenarios via the URL: `?swell=1.8,13,220&wind=12,20&tide=0.3`
(swell = Hs m, period s, direction from °; wind = km/h, direction from °; tide = m vs mean sea level).

## Data
Open-Meteo marine (open-ocean point 36.875 N, 8.875 W; tide from the point near Luz) and weather forecasts.
EMODnet Bathymetry DTM 2022 and 2011 Algarve LiDAR (CC-BY 4.0).

## Known limitations
- Spot pins are provisional; adjust `data/spots.seed.json` and rerun `pipeline/spots.py` + `build_tables.py`.
- No diffraction: swell fully shadowed by Sagres (W–NW) only arrives through its directional spread.
- The 2011 LiDAR doesn't capture today's sandbars, which decide real peel and closeouts.
- Datum offset MSL−LAT assumed 2.0 m at Lagos.
- Sizes are uncalibrated physics; webcam grading (phase 2) will correct per-spot biases.
