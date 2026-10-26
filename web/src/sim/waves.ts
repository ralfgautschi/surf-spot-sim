// Linear wave theory, mirrors pipeline/waves.py.
export const G = 9.81;

/** Wavenumber (rad/m), Guo (2002) explicit approximation. */
export function wavenumber(T: number, h: number): number {
  const d = Math.max(h, 1e-3);
  const omega = (2 * Math.PI) / T;
  const k0h = (omega * omega * d) / G;
  const kh = k0h * Math.pow(1 - Math.exp(-Math.pow(k0h, 1.25)), -0.4);
  return kh / d;
}

/** Phase speed c and group speed cg (m/s). */
export function celerity(T: number, h: number): { c: number; cg: number } {
  const d = Math.max(h, 1e-3);
  const k = wavenumber(T, d);
  const c = (2 * Math.PI) / T / k;
  const kh2 = Math.min(2 * k * d, 700);
  const n = 0.5 * (1 + kh2 / Math.sinh(kh2));
  return { c, cg: n * c };
}

export const deepWaterLength = (T: number) => (G * T * T) / (2 * Math.PI);

/** Signed smallest difference a - b in degrees, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  return ((((a - b + 180) % 360) + 360) % 360) - 180;
}

export const M_TO_FT = 3.28084;
