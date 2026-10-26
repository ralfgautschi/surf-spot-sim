// Forward ray tracing over the whole (smoothed, 50 m) grid for the bay view.
// Rays start at the grid edge on a straight offshore front, so headlands (Sagres, Ponta da Piedade)
// cast their shadows. Each ray stores position, accumulated phase (cycles) and depth.
import { celerity, deepWaterLength, wavenumber } from "../sim/waves";

export interface BayGrid {
  x0: number;
  y0: number;
  dx: number;
  nx: number;
  ny: number;
  z0: number;
  z: Float32Array; // m above LAT, row-major from the south-west
}

export async function loadBayGrid(base = "./data"): Promise<BayGrid> {
  const meta = await (await fetch(`${base}/bay.json`)).json();
  const buf = await (await fetch(`${base}/bay.bin`)).arrayBuffer();
  const q = new Int16Array(buf);
  const z = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) z[i] = q[i] * meta.scale;
  return { x0: meta.x0, y0: meta.y0, dx: meta.dx, nx: meta.nx, ny: meta.ny, z0: meta.z0, z };
}

export function depthAt(g: BayGrid, x: number, y: number, tide: number): number {
  const fx = (x - g.x0) / g.dx,
    fy = (y - g.y0) / g.dx;
  const i = Math.floor(fx),
    j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN;
  const tx = fx - i,
    ty = fy - j;
  const k = j * g.nx + i;
  const z = (1 - ty) * ((1 - tx) * g.z[k] + tx * g.z[k + 1]) + ty * ((1 - tx) * g.z[k + g.nx] + tx * g.z[k + g.nx + 1]);
  return g.z0 + tide - z;
}

export interface Ray {
  x: Float32Array;
  y: Float32Array;
  phase: Float32Array; // cycles
  depth: Float32Array;
  n: number;
}

export interface RayFan {
  rays: Ray[];
  spacing: number;
  T: number;
  dir: number;
}

const STEP = 25;
const MAX_STEPS = 2600;

/** Phase speed, its gradient and wavenumber on the grid for one period and tide. */
interface SpeedGrid {
  c: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
  k: Float32Array;
  d: Float32Array;
}

function speedGrid(g: BayGrid, T: number, tide: number): SpeedGrid {
  const N = g.nx * g.ny;
  const c = new Float32Array(N),
    k = new Float32Array(N),
    d = new Float32Array(N),
    cx = new Float32Array(N),
    cy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    d[i] = g.z0 + tide - g.z[i];
    const h = Math.max(d[i], 0.05);
    k[i] = wavenumber(T, h);
    c[i] = (2 * Math.PI) / T / k[i];
  }
  for (let j = 1; j < g.ny - 1; j++)
    for (let i = 1; i < g.nx - 1; i++) {
      const q = j * g.nx + i;
      cx[q] = (c[q + 1] - c[q - 1]) / (2 * g.dx);
      cy[q] = (c[q + g.nx] - c[q - g.nx]) / (2 * g.dx);
    }
  return { c, cx, cy, k, d };
}

function bilinear(g: BayGrid, a: Float32Array, x: number, y: number): number {
  const fx = (x - g.x0) / g.dx,
    fy = (y - g.y0) / g.dx;
  const i = Math.floor(fx),
    j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN;
  const tx = fx - i,
    ty = fy - j;
  const q = j * g.nx + i;
  return (1 - ty) * ((1 - tx) * a[q] + tx * a[q + 1]) + ty * ((1 - tx) * a[q + g.nx] + tx * a[q + g.nx + 1]);
}

/** Trace a fan of parallel rays for waves of period T coming from `dirFrom` (deg). */
export function traceFan(g: BayGrid, T: number, dirFrom: number, tide: number, spacing = 120): RayFan {
  const sg = speedGrid(g, T, tide);
  const travel = ((dirFrom + 180) * Math.PI) / 180;
  const ux = Math.sin(travel),
    uy = Math.cos(travel);
  // Front through a point far upstream of the grid centre
  const cx = g.x0 + (g.nx * g.dx) / 2,
    cy = g.y0 + (g.ny * g.dx) / 2;
  const R = Math.hypot(g.nx, g.ny) * g.dx;
  const px = cx - ux * R,
    py = cy - uy * R;
  const L0 = deepWaterLength(T);
  const xmin = g.x0,
    xmax = g.x0 + (g.nx - 1) * g.dx,
    ymin = g.y0,
    ymax = g.y0 + (g.ny - 1) * g.dx;
  const rays: Ray[] = [];

  for (let off = -R; off <= R; off += spacing) {
    let x = px - uy * off,
      y = py + ux * off;
    // advance straight to the grid boundary (slab intersection)
    let tEnter = 0,
      tExit = Infinity;
    for (const [p, u, lo, hi] of [
      [x, ux, xmin + 1, xmax - 1],
      [y, uy, ymin + 1, ymax - 1],
    ] as const) {
      if (Math.abs(u) < 1e-9) {
        if (p < lo || p > hi) tEnter = Infinity;
      } else {
        const t1 = (lo - p) / u,
          t2 = (hi - p) / u;
        tEnter = Math.max(tEnter, Math.min(t1, t2));
        tExit = Math.min(tExit, Math.max(t1, t2));
      }
    }
    if (!(tEnter < tExit)) continue;
    x += ux * tEnter;
    y += uy * tEnter;
    let phi = travel;
    let phase = tEnter / L0; // deep water up to the boundary keeps crests continuous across rays
    const xs = new Float32Array(MAX_STEPS),
      ys = new Float32Array(MAX_STEPS),
      ph = new Float32Array(MAX_STEPS),
      ds = new Float32Array(MAX_STEPS);
    let n = 0;
    for (let k = 0; k < MAX_STEPS; k++) {
      const d = bilinear(g, sg.d, x, y);
      if (!(d > 0.3)) break;
      xs[n] = x;
      ys[n] = y;
      ph[n] = phase;
      ds[n] = d;
      n++;
      // ray curvature dphi/ds = -(cx cos phi - cy sin phi)/c (bearing convention), midpoint step
      const c = bilinear(g, sg.c, x, y);
      const dphi = (-(bilinear(g, sg.cx, x, y) * Math.cos(phi) - bilinear(g, sg.cy, x, y) * Math.sin(phi)) / c) * STEP;
      const pm = phi + 0.5 * dphi;
      x += STEP * Math.sin(pm);
      y += STEP * Math.cos(pm);
      phi += dphi;
      phase += (bilinear(g, sg.k, xs[n - 1], ys[n - 1]) * STEP) / (2 * Math.PI);
    }
    if (n > 1) rays.push({ x: xs.subarray(0, n), y: ys.subarray(0, n), phase: ph.subarray(0, n), depth: ds.subarray(0, n), n });
  }
  return { rays, spacing, T, dir: dirFrom };
}

/** Shoaling factor relative to deep water at a depth (for crest brightness). */
export function shoal(T: number, d: number): number {
  return Math.sqrt((9.81 * T) / (4 * Math.PI) / celerity(T, Math.max(d, 0.05)).cg);
}
