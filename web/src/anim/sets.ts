// Synthesise wave components from the partitions at a spot, so the animation shows sets and lulls.
// Each partition gets a narrow Gaussian spectrum around its period: narrower for long-period swell,
// which gives longer, more distinct wave groups.
import type { LocalPartition } from "../sim/surf";

export interface Component {
  f: number; // Hz
  a: number; // amplitude at the reference point, m
  phase: number; // rad
  dir: number; // local direction (from), deg
}

/** Small deterministic RNG (mulberry32) so a given hour always animates the same way. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function synthesize(parts: (LocalPartition & { kind?: string })[], seed: number, perPartition = 14): Component[] {
  const rand = rng(seed);
  const out: Component[] = [];
  for (const p of parts) {
    if (!(p.Hs > 0.02) || !isFinite(p.dir)) continue;
    const fp = 1 / p.T;
    const rel = p.T >= 10 ? 0.045 : p.T >= 7 ? 0.07 : 0.1; // relative spectral width
    const sf = rel * fp;
    const m0 = (p.Hs * p.Hs) / 16;
    const fs: number[] = [];
    const ws: number[] = [];
    for (let j = 0; j < perPartition; j++) {
      const u = -2.2 + (4.4 * (j + 0.5)) / perPartition;
      const f = fp + u * sf + (rand() - 0.5) * ((4.4 * sf) / perPartition) * 0.8;
      fs.push(f);
      ws.push(Math.exp(-0.5 * u * u));
    }
    const wsum = ws.reduce((a, b) => a + b, 0);
    fs.forEach((f, j) => {
      const var_j = (m0 * ws[j]) / wsum; // variance carried by this component
      out.push({ f, a: Math.sqrt(2 * var_j), phase: rand() * 2 * Math.PI, dir: p.dir });
    });
  }
  return out;
}
