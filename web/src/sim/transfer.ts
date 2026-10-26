// Offshore partition -> reference point (10 m depth) using the backward-ray tables.
// Mirrors pipeline/transfer.py: K^2 = sum_l D(theta_off(l)) * (c cg)_off/(c cg)_ref * dtheta.
import { angleDiff } from "./waves";

export interface RayMap {
  T: number;
  local: number[];
  offshore: (number | null)[];
  ratio: (number | null)[];
}

export interface TransferTable {
  id: string;
  ref: { x: number; y: number; s: number; depth: number };
  periods: RayMap[];
}

export type PartitionKind = "swell" | "wind";

export function spreadDeg(T: number, kind: PartitionKind): number {
  if (kind === "wind") return 30;
  return Math.min(Math.max(30 - 1.2 * T, 10), 25);
}

const DTHETA = (1 * Math.PI) / 180;
const normCache = new Map<number, number>();

/** cos^2s(Δ/2) directional distribution (rad^-1) with spread sigma (deg). */
export function directional(theta: number, mean: number, sigma: number): number {
  const s = Math.max(2 / Math.pow((sigma * Math.PI) / 180, 2) - 1, 0.5);
  let norm = normCache.get(s);
  if (norm === undefined) {
    let sum = 0;
    for (let d = -180; d < 180; d += 0.5) sum += Math.pow(Math.cos((d * Math.PI) / 360), 2 * s);
    norm = 1 / (sum * ((0.5 * Math.PI) / 180));
    normCache.set(s, norm);
  }
  const d = (angleDiff(theta, mean) * Math.PI) / 180;
  return norm * Math.pow(Math.cos(d / 2), 2 * s);
}

/** Energy factor K^2 and energy-weighted local direction for one ray map. */
export function applyRayMap(rm: RayMap, mean: number, sigma: number): { K2: number; dir: number } {
  let k2 = 0,
    sx = 0,
    cy = 0;
  for (let i = 0; i < rm.local.length; i++) {
    const off = rm.offshore[i];
    const r = rm.ratio[i];
    if (off === null || r === null) continue;
    const w = directional(off, mean, sigma) * r * DTHETA;
    k2 += w;
    const a = (rm.local[i] * Math.PI) / 180;
    sx += w * Math.sin(a);
    cy += w * Math.cos(a);
  }
  const dir = k2 > 0 ? (((Math.atan2(sx, cy) * 180) / Math.PI) % 360 + 360) % 360 : NaN;
  return { K2: k2, dir };
}

/** Height factor K and local mean direction, interpolating linearly in period between table entries. */
export function transfer(table: TransferTable, T: number, mean: number, sigma: number): { K: number; dir: number } {
  const ps = table.periods;
  const t = Math.min(Math.max(T, ps[0].T), ps[ps.length - 1].T);
  let i = ps.findIndex((p) => p.T >= t);
  if (i <= 0) i = 1;
  const a = ps[i - 1],
    b = ps[i];
  const f = (t - a.T) / (b.T - a.T);
  const ra = applyRayMap(a, mean, sigma);
  const rb = applyRayMap(b, mean, sigma);
  const K2 = (1 - f) * ra.K2 + f * rb.K2;
  let dir: number;
  if (!isFinite(ra.dir)) dir = rb.dir;
  else if (!isFinite(rb.dir)) dir = ra.dir;
  else dir = (ra.dir + f * angleDiff(rb.dir, ra.dir) + 360) % 360;
  return { K: Math.sqrt(K2), dir };
}
