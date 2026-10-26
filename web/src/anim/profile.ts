// Side view of one spot: linear wave components propagated shoreward along the cross-shore profile
// (shoaling + Snell), a depth-limited breaking cap, advected whitewater and a plunging lip.
import { profileArrays, GAMMA, type BreakerType, type Spot } from "../sim/surf";
import { angleDiff, celerity, wavenumber } from "../sim/waves";
import type { Component } from "./sets";

const CREST_CAP = 0.5 * GAMMA; // crest elevation ≈ H/2 at breaking
const FOAM_DECAY_S = 5;
const BEACH_POINTS = 10; // profile points kept landward of the shoreline (50 m)

export interface ProfileModel {
  s: Float64Array; // m seaward of the shoreline (negative on the beach)
  depth: Float64Array;
  wet: Uint8Array;
  amp: Float32Array[]; // per component, amplitude along s
  psi: Float32Array[]; // per component, accumulated phase from the reference point (rad)
  omega: Float64Array;
  phase0: Float64Array;
  shallowC: Float64Array; // sqrt(g h) for foam advection
  refI: number;
  breaker: BreakerType;
  z0: number;
  tide: number;
  zLAT: Float64Array;
}

export function buildProfileModel(spot: Spot, comps: Component[], z0: number, tide: number, breaker: BreakerType): ProfileModel {
  const { s: sAll, depth: dAll } = profileArrays(spot, z0, tide);
  const refAll = Math.round((spot.ref.s - spot.profile.start) / spot.profile.step);
  let shore = refAll;
  while (shore > 0 && dAll[shore - 1] > 0) shore--;
  const lo = Math.max(0, shore - BEACH_POINTS);
  const hi = Math.min(sAll.length - 1, refAll + 40);
  const n = hi - lo + 1;
  const s = new Float64Array(n),
    depth = new Float64Array(n),
    zLAT = new Float64Array(n),
    shallowC = new Float64Array(n),
    wet = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = sAll[lo + i] - sAll[shore];
    wet[i] = i >= shore - lo ? 1 : 0;
    depth[i] = Math.max(dAll[lo + i], 0.02);
    zLAT[i] = spot.profile.zLAT[lo + i];
    shallowC[i] = Math.sqrt(9.81 * depth[i]);
  }
  const refI = refAll - lo;
  const step = spot.profile.step;
  const amp: Float32Array[] = [];
  const psi: Float32Array[] = [];
  for (const c of comps) {
    const T = 1 / c.f;
    const ref = celerity(T, depth[refI]);
    const th = (angleDiff(c.dir, spot.facing) * Math.PI) / 180;
    const a = new Float32Array(n);
    const p = new Float32Array(n);
    let acc = 0;
    for (let i = n - 1; i >= 0; i--) {
      if (!wet[i]) break;
      const h = depth[i];
      const { c: ci, cg } = celerity(T, h);
      const sinA = Math.min(Math.sin(th) * (ci / ref.c), 0.999);
      const cosA = Math.sqrt(1 - sinA * sinA);
      const K = Math.sqrt(ref.cg / cg) * Math.sqrt(Math.cos(th) / cosA);
      a[i] = c.a * (i >= refI ? 1 : K);
      // phase accumulates with the cross-shore wavenumber component
      if (i < n - 1) acc += wavenumber(T, h) * cosA * step;
      p[i] = acc;
    }
    // shift so psi = 0 at the reference point (phases are defined there)
    const off = p[refI];
    for (let i = 0; i < n; i++) p[i] -= off;
    amp.push(a);
    psi.push(p);
  }
  return {
    s,
    depth,
    wet,
    amp,
    psi,
    omega: Float64Array.from(comps.map((c) => 2 * Math.PI * c.f)),
    phase0: Float64Array.from(comps.map((c) => c.phase)),
    shallowC,
    refI,
    breaker,
    z0,
    tide,
    zLAT,
  };
}

export class ProfileSim {
  foam: Float32Array;
  eta: Float32Array;
  lips: { i: number; age: number; H: number }[] = [];
  private broken: Uint8Array;

  constructor(public m: ProfileModel) {
    this.foam = new Float32Array(m.s.length);
    this.eta = new Float32Array(m.s.length);
    this.broken = new Uint8Array(m.s.length);
  }

  step(t: number, dt: number) {
    const m = this.m;
    const n = m.s.length;
    for (let i = 0; i < n; i++) {
      if (!m.wet[i]) {
        this.eta[i] = 0;
        continue;
      }
      let e = 0;
      for (let j = 0; j < m.amp.length; j++) e += m.amp[j][i] * Math.cos(m.psi[j][i] - m.omega[j] * t + m.phase0[j]);
      const h = m.depth[i];
      // mild nonlinearity: sharper crests, flatter troughs in shallow water
      e = e + (0.6 * e * Math.abs(e)) / Math.max(h, 0.3);
      this.eta[i] = Math.max(-0.35 * h, e);
    }
    // advect foam shoreward at the shallow-water speed (semi-Lagrangian), decaying
    const decay = Math.exp(-dt / FOAM_DECAY_S);
    const ds = m.s[1] - m.s[0];
    const nf = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const src = i + (m.shallowC[i] * dt) / ds;
      const i0 = Math.min(Math.floor(src), n - 1);
      const f = src - i0;
      const v = i0 >= n - 1 ? 0 : this.foam[i0] * (1 - f) + this.foam[i0 + 1] * f;
      nf[i] = m.wet[i] ? v * decay : 0;
    }
    // breaking: cap crests at the depth limit and seed whitewater there
    for (let i = 0; i < n; i++) {
      const cap = CREST_CAP * m.depth[i];
      if (this.eta[i] > cap) {
        const over = this.eta[i] - cap;
        if (!this.broken[i] && m.breaker === "plunging" && i > 2 && this.eta[i] > 0.2) {
          this.lips.push({ i, age: 0, H: this.eta[i] * 2 });
        }
        this.broken[i] = 1;
        nf[i] = Math.min(1, Math.max(nf[i], 0.6 + over / Math.max(cap, 0.1)));
        this.eta[i] = cap + 0.25 * over;
      } else if (this.eta[i] < 0.5 * cap) {
        this.broken[i] = 0;
      }
    }
    this.foam = nf;
    // lips travel with the shallow-water speed and fade after ~0.9 s
    for (const l of this.lips) {
      l.age += dt;
      l.i = Math.max(0, l.i - Math.round((m.shallowC[Math.round(l.i)] * dt) / ds));
    }
    this.lips = this.lips.filter((l) => l.age < 0.9).slice(-6);
  }
}

export interface ProfileStyle {
  sea: string;
  seaSoft: string;
  foam: string;
  sand: string;
  ink: string;
  muted: string;
  accent: string;
}

export function drawProfile(ctx: CanvasRenderingContext2D, w: number, h: number, sim: ProfileSim, style: ProfileStyle, xMax: number, label: string) {
  const m = sim.m;
  const n = m.s.length;
  const sMin = m.s[0];
  let nn = m.s.findIndex((v) => v > xMax);
  if (nn < 0) nn = n;
  const dMax = Math.max(1.5, ...Array.from(m.depth.subarray(0, nn)));
  const top = 0.38 * h; // mean water level
  const vs = (h - top - 14) / dMax; // px per metre (vertical)
  const X = (sx: number) => ((sx - sMin) / (xMax - sMin)) * w; // beach on the left, sea to the right
  const px = (i: number) => X(m.s[i]);
  const Y = (z: number) => top - z * vs;
  ctx.clearRect(0, 0, w, h);
  // sky band
  ctx.fillStyle = style.seaSoft;
  ctx.fillRect(0, 0, w, h);

  // water body
  ctx.beginPath();
  ctx.moveTo(0, Y(0));
  for (let i = 0; i < nn; i++) ctx.lineTo(px(i), Y(sim.eta[i]));
  ctx.lineTo(w, Y(sim.eta[nn - 1]));
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = style.sea;
  ctx.fill();

  // whitewater on the surface
  ctx.lineCap = "round";
  for (let i = 0; i < nn - 1; i++) {
    const f = sim.foam[i];
    if (f < 0.05) continue;
    ctx.strokeStyle = style.foam;
    ctx.globalAlpha = Math.min(1, f);
    ctx.lineWidth = 2 + 6 * f;
    ctx.beginPath();
    ctx.moveTo(px(i), Y(sim.eta[i]) + 2);
    ctx.lineTo(px(i + 1), Y(sim.eta[i + 1]) + 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // plunging lips: a curl thrown forward (toward the shore = left)
  for (const l of sim.lips) {
    const i = Math.round(l.i);
    if (i >= nn) continue;
    const x0 = px(i),
      y0 = Y(sim.eta[i]);
    const len = Math.max(8, l.H * vs * 0.9) * (0.5 + l.age);
    ctx.strokeStyle = style.foam;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1 - l.age / 0.9;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 - len * 0.8, y0 - len * 0.35, x0 - len, y0 + len * 0.6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // seabed and beach (drawn last so it covers the water below it)
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, Y(m.zLAT[0] - m.z0 - m.tide));
  for (let i = 0; i < nn; i++) ctx.lineTo(px(i), Y(m.zLAT[i] - m.z0 - m.tide));
  ctx.lineTo(w, Y(m.zLAT[nn - 1] - m.z0 - m.tide));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = style.sand;
  ctx.fill();

  // scale: 1 m bar and a 1.8 m surfer at the reference point for size
  ctx.fillStyle = style.ink;
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText(label, 8, 16);
  const bx = w - 40;
  ctx.fillRect(bx, Y(1.5), 2, vs);
  ctx.fillText("1 m", bx + 5, Y(1.5) + vs / 2 + 4);
  ctx.fillStyle = style.muted;
  for (let d = 0; d <= xMax; d += 50) {
    const x = X(d);
    ctx.fillRect(x, h - 6, 1, 6);
    ctx.fillText(d === 0 ? "shore" : `${d} m`, x + 2, h - 8);
  }
}
