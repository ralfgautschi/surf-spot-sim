import { M_TO_FT } from "../sim/waves";
import type { SpotResult } from "../sim/surf";

export const ft = (m: number) => m * M_TO_FT;

export function sizeRange(r: SpotResult): string {
  if (!r.set || r.set.H < 0.15) return "flat";
  const lo = Math.max(0, Math.round(ft(r.typical?.H ?? 0)));
  const hi = Math.max(1, Math.round(ft(r.set.H)));
  return lo >= hi ? `${hi} ft` : `${lo}–${hi} ft`;
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number) => (isFinite(deg) ? COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] : "–");

export const hhmm = (iso: string) => iso.slice(11, 16);

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export const BREAKER_TEXT: Record<string, string> = {
  spilling: "crumbly (spilling)",
  plunging: "hollow (plunging)",
  surging: "surging / shorebreak",
  flat: "no surf",
};

export function surfaceClass(s: string): string {
  if (s === "glassy" || s === "offshore" || s === "cross-offshore") return "good";
  if (s === "light onshore" || s === "cross-shore") return "warn";
  if (s === "choppy" || s === "blown out") return "bad";
  return "";
}
