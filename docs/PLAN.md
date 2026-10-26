# Luz Surf Sim: wave simulation per spot at Praia da Luz, graded by webcams

## Context
Surfline's broad swell and wind forecast for Praia da Luz is decent, but its single rating for the whole beach doesn't match what actually happens on the sand. The three spots react differently to the same swell. From west to east:
- **Fortaleza** (west end, by the fort and church)
- **Chico Times** (middle)
- **Rocha Negra** (east end, under the black cliff)

Goal: take the offshore forecast and **simulate how the waves arrive and break at each spot**, both as numbers and as an **animation** (set waves, size, where they break, peel direction, crumbly or hollow). Then grade the simulation automatically against **webcam images**, because you aren't in Luz most of the year.

**Scope of this phase: sections 1–4 (bathymetry → transfer tables → simulation → animation).** Webcam grading (5) and calibration (6) come later. The design below keeps room for them: simulation output is a plain per-hour JSON per spot, so the grader can be added later without changing the simulation.

Repo: https://github.com/ralfgautschi/surf-spot-sim. Attach it with `add_repo` (push access) and clone it to `/home/user/surf-spot-sim`. **The first commit adds this plan as `docs/PLAN.md`**, then the work starts on build step 1.

## How it works (overview)
```
Open-Meteo offshore swell partitions ─┐
                                      ├─► per-spot transfer tables ─► waves at each spot ─► animation + numbers
EMODnet LiDAR bathymetry (~14 m) ─────┘   (precomputed by ray tracing,     (height, direction, where they break,
                                           with tide as an input)           peel, breaker type)
Webcam frames ─► area for each spot ─► observed whitewater line + vision grade ─► compare with simulation ─► per-spot correction
```

## 1. Bathymetry and spot geometry (`pipeline/`, Python)
- Download the EMODnet high-resolution LiDAR Algarve DTM (`590_HR_Lidar_Algarve`, XYZ, CC-BY 4.0) and the EMODnet 115 m DTM for deeper water. Merge them into one grid of the bay: roughly Ponta da Piedade to Burgau, out to about 50 m depth.
- **Check before anything else:** that the LiDAR survey covers Luz and reaches about 10 m depth. If it doesn't, fall back to the 115 m DTM plus an idealised beach profile you can adjust for each spot.
- `spots.json` holds, for each spot: the take-off point (lat/lon), a cross-shore line from deep water to the beach, and the direction the shoreline runs. Set these by dropping pins in a small setup map in the app.

## 2. Nearshore transformation (precomputed transfer tables)
- **Backward ray tracing** from each spot's take-off point (`pipeline/raytrace.py`, NumPy): for each wave period (6–20 s) and shooting direction, trace the ray offshore over the smoothed depth grid using the linear dispersion relation. This shows which offshore directions reach the spot (blocking by Ponta da Piedade, wrap of westerly swell), and the refraction and shoaling coefficients along the way.
- Output: `transfer/{spot}.json`, which maps (offshore direction, period) to (energy coefficient, local direction at about 10 m depth), plus the depth profile along the cross-shore line.
- Also precompute **forward-ray crest fields** for a coarse grid of direction and period. These give the shape of the crest lines that the top-down animation draws.
- Optional later check: run SWAN for a few cases and compare against the ray tracing.

## 3. Forecast → waves at each spot (in the browser, TypeScript)
- Get the hourly offshore swell partitions (primary, secondary, wind waves) and `sea_level_height_msl` for the tide from Open-Meteo Marine, and wind from Open-Meteo Forecast.
- For each spot and hour:
  1. Apply the transfer table to each swell partition and combine their energy.
  2. Shoal the result along the cross-shore line, with depth shifted by the tide.
  3. The wave breaks where height reaches about 0.78 × depth. That gives **breaker height (face, ft/m), how far out it breaks, the breaker type** (spilling, plunging or surging, from the Iribarren number, which compares beach slope to wave steepness), and **peel direction** (from the angle between the crest and the depth contours).
  4. Adjust for wind: offshore wind holds the face up, onshore wind makes it crumbly and choppy.
- Set structure: model wave groups from the swell's period and how narrow its spectrum is, so that sets and lulls are visible.

## 4. Animation (Canvas 2D, Preact UI)
- **Top-down bay view:** bathymetry shading, swell crests bending around the headland, whitewater appearing at each spot's break zone. An hour slider scrubs through the forecast.
- **Side view per spot:** waves moving along the cross-shore line with the right height, period and set rhythm. Each wave pitches, spills or surges according to its breaker type, and the tide level moves.
- Below the animation: hourly numbers for the three spots side by side, so you can compare spots under the same swell and wind.

## 5. Webcam grading (`grader/`, Python, runs on a schedule)
- **Step 0: check camera access and terms.** Candidates: the MEO HD-Beachcam Praia da Luz (has an image archive), the Windy-listed cam looking toward Rocha Negra, and the Ocean Villas cam looking toward the Fortaleza. Prefer the official Windy Webcams API (images and timelapse) over scraping, and use a camera only if its terms allow automated stills.
- **Capture:** a frame every 30 minutes in daylight, plus a short burst (about 10 frames over 2 minutes) so the grader catches sets.
- **Camera geometry:** a one-off fit that maps image pixels to positions on the water surface, using 4 or more landmarks (fort, Rocha Negra, groynes and rocks) taken from the LiDAR and orthophoto. With that, the outer edge of the whitewater in each spot's image area converts to **breaking distance from shore in metres**.
- **Measurements per spot:**
  - *Objective:* the outermost whitewater line (from brightness or foam detection across the burst), the fraction of the spot's image area covered in whitewater, and how many breaking events there are.
  - *Vision grade:* the frames go to Claude with a fixed scoring rubric: face height using reference objects, clean/choppy/blown-out, closeout or peeling, and a confidence score. Low-confidence frames are dropped (fog, glare, night).
- Store observations as `observations/YYYY-MM.jsonl`, together with the simulation output for the same hour.
- **Runs on:** a scheduled GitHub Actions workflow in the project repo. The Claude API key is stored as a repository secret. Cost is roughly 30 vision calls a day.

## 6. Grading and calibration
- For each spot, compare simulated against observed: breaking distance, height, and the clean/closeout classification.
- Fit small per-spot corrections (a height multiplier, an offset for where waves break, and a nudge to which offshore directions reach the spot). Store them as `calibration.json`; the app loads this file.
- A **Grades** page shows each spot's error over time and the simulation next to the webcam frame for any past hour.

## Repo layout
```
pipeline/   bathymetry.py, raytrace.py, crestfield.py, build_tables.py
grader/     capture.py, geometry.py, foam.py, vision_grade.py, compare.py
web/        src/data/openmeteo.ts, src/sim/{transfer,shoal,breaking,sets}.ts, src/anim/{bay,profile}.ts, src/ui/*
data/       spots.json, transfer/*.json, calibration.json, observations/
.github/workflows/grade.yml
```

## Build order
1. Load the bathymetry, place the spots, and visually check the depth grid. **This is the go/no-go point for the physics approach.**
2. Ray-tracing transfer tables and unit tests (a flat seabed must return the input unchanged; a westerly swell must be heavily cut at a south-facing spot).
3. Browser simulation and numbers view.
4. Animation: side view first, then the bay view.
5. Webcam access, capture and camera geometry.
6. Whitewater line detection and vision grading.
7. Comparison, calibration and the Grades page.

## Verification
- `pytest` for the pipeline and grader; `vitest` for the browser simulation.
- Back-test: pick past days with very different swells (big W winter swell, small S summer swell, SW swell). Fetch Open-Meteo historical forecasts and the archived cam frames for those days, and check the simulation's ranking of the three spots against the frames.
- Check the animation at phone width with a Playwright screenshot.
- Hand-check: run the grader on 20 frames and compare its grades with your own reading of the same frames.

(This phase covers build steps 1–4 only. In Verification, the webcam back-test and the grader hand-check wait until phase 2. For now, sanity-check the spot ranking against what you remember of those days.)

## Open items for you
- Confirm or correct the spot pins once the setup map is built.
- Later (phase 2): a Claude API key as a repo secret, for the vision grading.
