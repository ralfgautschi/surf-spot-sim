// From the reference point (10 m) to the beach along a spot's cross-shore profile:
// Snell refraction over straight contours, shoaling, depth-limited breaking, breaker type, peel, wind.
import { angleDiff, celerity, deepWaterLength } from "./waves";

export const GAMMA = 0.78; // breaking index H/h for an individual wave
export const SET_FACTOR = 1.27; // H1/10 ≈ 1.27 Hs: the bigger waves of the sets

export interface Spot {
  id: string;
  name: string;
  facing: number;
  x: number;
  y: number;
  ref: { x: number; y: number; s: number; depth: number };
  profile: { step: number; start: number; zLAT: number[] };
}

/** A wave partition arriving at the reference point (after the transfer tables). */
export interface LocalPartition {
  Hs: number;
  T: number;
  dir: number; // local direction waves come from (deg)
}

export interface Wind {
  speedKmh: number;
  gustKmh: number;
  dirFrom: number;
}

export type BreakerType = "spilling" | "plunging" | "surging" | "flat";
export type Peel = "left" | "right" | "closeout" | "none";
export type Surface = "glassy" | "offshore" | "cross-offshore" | "cross-shore" | "light onshore" | "choppy" | "blown out" | "unknown";

export interface BreakPoint {
  H: number; // breaking (face) height, m
  depth: number; // water depth at the break, m
  s: number; // profile coordinate of the break
  distance: number; // m from the shoreline at the current tide
}

export interface SpotResult {
  HsRef: number;
  typical: BreakPoint | null;
  set: BreakPoint | null;
  Tdom: number;
  dirLocal: number;
  iribarren: number;
  breaker: BreakerType;
  peel: Peel;
  peelAngle: number; // crest angle to the depth contours at the break, deg
  onshoreKmh: number; // + onshore, - offshore
  crossKmh: number;
  surface: Surface;
  shorelineS: number;
  /** Hs along the profile (seaward of the shoreline), for drawing. */
  line: { s: number[]; depth: number[]; Hs: number[] };
}

const rad = (d: number) => (d * Math.PI) / 180;

export function profileArrays(spot: Spot, z0: number, tide: number) {
  const n = spot.profile.zLAT.length;
  const s = new Array<number>(n);
  const depth = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    s[i] = spot.profile.start + i * spot.profile.step;
    depth[i] = z0 + tide - spot.profile.zLAT[i];
  }
  return { s, depth };
}

/** Index of the shoreline: first wet point seaward of the last dry one near the take-off. */
function shorelineIndex(depth: number[], refIdx: number): number {
  for (let i = refIdx; i > 0; i--) if (depth[i - 1] <= 0) return i;
  return 0;
}

export function surfAtSpot(spot: Spot, parts: LocalPartition[], z0: number, tide: number, wind: Wind | null): SpotResult {
  const { s, depth } = profileArrays(spot, z0, tide);
  const refIdx = Math.max(0, Math.min(s.length - 1, Math.round((spot.ref.s - spot.profile.start) / spot.profile.step)));
  const shore = shorelineIndex(depth, refIdx);
  const live = parts.filter((p) => p.Hs > 0.02 && isFinite(p.dir));

  // Snell + shoaling per partition from the reference depth inward.
  const hRef = Math.max(depth[refIdx], 0.5);
  const Hs = new Array<number>(s.length).fill(0);
  const theta = live.map((p) => rad(angleDiff(p.dir, spot.facing)));
  const refC = live.map((p) => celerity(p.T, hRef));
  for (let i = shore; i <= refIdx; i++) {
    const h = Math.max(depth[i], 0.05);
    let e = 0;
    live.forEach((p, k) => {
      const { c, cg } = celerity(p.T, h);
      const sinA = Math.min(Math.sin(theta[k]) * (c / refC[k].c), 0.999);
      const Kr = Math.sqrt(Math.cos(theta[k]) / Math.sqrt(1 - sinA * sinA));
      const Ks = Math.sqrt(refC[k].cg / cg);
      e += Math.pow(p.Hs * Ks * Kr, 2);
    });
    Hs[i] = Math.sqrt(e);
  }
  const HsRef = Math.sqrt(live.reduce((a, p) => a + p.Hs * p.Hs, 0));

  const findBreak = (factor: number): BreakPoint | null => {
    if (HsRef < 0.03) return null;
    for (let i = refIdx; i >= shore; i--) {
      const h = Math.max(depth[i], 0.05);
      const H = factor * Hs[i];
      if (H >= GAMMA * h || i === shore) {
        return { H, depth: h, s: s[i], distance: s[i] - s[shore] };
      }
    }
    return null;
  };
  const typical = findBreak(1);
  const set = findBreak(SET_FACTOR);

  // Dominant partition (by energy at the reference point) sets period and direction.
  const dom = live.reduce<LocalPartition | null>((a, p) => (!a || p.Hs > a.Hs ? p : a), null);
  const Tdom = dom?.T ?? 0;
  const dirLocal = dom?.dir ?? NaN;

  // Iribarren number at the set-wave break with the local slope over ±25 m.
  let iribarren = 0;
  let breaker: BreakerType = "flat";
  if (set && dom) {
    const i = Math.round((set.s - spot.profile.start) / spot.profile.step);
    const w = Math.round(25 / spot.profile.step);
    const i0 = Math.max(shore, i - w),
      i1 = Math.min(s.length - 1, i + w);
    const slope = Math.max(Math.abs((depth[i1] - depth[i0]) / (s[i1] - s[i0])), 1e-3);
    iribarren = slope / Math.sqrt(set.H / deepWaterLength(Tdom));
  }

  // Wind relative to the spot: + onshore (blowing from the facing direction).
  let onshoreKmh = 0,
    crossKmh = 0;
  let surface: Surface = "unknown";
  if (wind) {
    const a = rad(angleDiff(wind.dirFrom, spot.facing));
    onshoreKmh = wind.speedKmh * Math.cos(a);
    crossKmh = Math.abs(wind.speedKmh * Math.sin(a));
    surface = classifySurface(wind.speedKmh, onshoreKmh, crossKmh);
  }

  if (set && dom && set.H > 0.15) {
    // Heuristic wind effect: offshore wind holds the face up (hollower), onshore makes it crumble.
    const xi = onshoreKmh < 0 ? iribarren * (1 + 0.02 * Math.min(-onshoreKmh, 30)) : iribarren / (1 + 0.03 * onshoreKmh);
    breaker = xi < 0.4 ? "spilling" : xi < 2.0 ? "plunging" : "surging";
    iribarren = xi;
  }

  // Peel: crest angle to the contours at the set-wave break depth (Snell from the reference point).
  let peel: Peel = "none";
  let peelAngle = 0;
  if (set && dom && breaker !== "flat") {
    const th = rad(angleDiff(dom.dir, spot.facing));
    const cRef = celerity(dom.T, hRef).c;
    const cB = celerity(dom.T, set.depth).c;
    peelAngle = (Math.asin(Math.min(Math.sin(th) * (cB / cRef), 0.999)) * 180) / Math.PI;
    // Looking out to sea, swell from the right (clockwise of facing) peels to the surfer's right.
    peel = Math.abs(peelAngle) < 4 ? "closeout" : peelAngle > 0 ? "right" : "left";
  }

  const lo = shore,
    hi = Math.min(s.length - 1, refIdx + 20);
  return {
    HsRef,
    typical,
    set,
    Tdom,
    dirLocal,
    iribarren,
    breaker,
    peel,
    peelAngle,
    onshoreKmh,
    crossKmh,
    surface,
    shorelineS: s[shore],
    line: { s: s.slice(lo, hi + 1), depth: depth.slice(lo, hi + 1), Hs: Hs.slice(lo, hi + 1) },
  };
}

export function classifySurface(speed: number, onshore: number, cross: number): Surface {
  if (speed < 5) return "glassy";
  if (onshore <= -Math.max(cross, 3)) return cross > -onshore * 0.6 ? "cross-offshore" : "offshore";
  if (cross > Math.abs(onshore) * 1.5) return speed > 25 ? "choppy" : "cross-shore";
  if (onshore < 12) return "light onshore";
  if (onshore < 25) return "choppy";
  return "blown out";
}
