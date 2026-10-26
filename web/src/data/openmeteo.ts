// Open-Meteo: offshore swell partitions (open ocean SW of Sagres), tide + coarse-model waves near Luz, local wind.

/** Open-ocean forcing point, outside the Sagres shadow, so W–NW swell is not pre-refracted by the coarse model. */
export const OFFSHORE_POINT = { lat: 36.875, lon: -8.875 };
/** Coarse-model grid point ~5 km off Luz: used for the tide and as a "coarse model says" comparison. */
export const NEAR_POINT = { lat: 37.04, lon: -8.73 };
export const WIND_POINT = { lat: 37.087, lon: -8.725 };

export interface OffshorePartition {
  kind: "swell" | "wind";
  label: string;
  Hs: number;
  T: number;
  dir: number;
}

export interface HourInput {
  time: string; // local ISO, Europe/Lisbon
  partitions: OffshorePartition[];
  offshoreHs: number;
  nearHs: number | null; // coarse-model total Hs near Luz
  tide: number; // m relative to MSL
  wind: { speedKmh: number; gustKmh: number; dirFrom: number } | null;
}

const MARINE = "https://marine-api.open-meteo.com/v1/marine";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

type Hourly = Record<string, (number | null)[]> & { time: string[] };

async function getHourly(base: string, p: { lat: number; lon: number }, vars: string[], days: number, pastDays = 0): Promise<Hourly> {
  const q = new URLSearchParams({
    latitude: String(p.lat),
    longitude: String(p.lon),
    hourly: vars.join(","),
    forecast_days: String(days),
    past_days: String(pastDays),
    timezone: "Europe/Lisbon",
  });
  if (base === FORECAST) q.set("wind_speed_unit", "kmh");
  const r = await fetch(`${base}?${q}`);
  if (!r.ok) throw new Error(`${base} ${r.status}`);
  return (await r.json()).hourly as Hourly;
}

const OFFSHORE_VARS = [
  "wave_height",
  "swell_wave_height",
  "swell_wave_peak_period",
  "swell_wave_period",
  "swell_wave_direction",
  "secondary_swell_wave_height",
  "secondary_swell_wave_period",
  "secondary_swell_wave_direction",
  "wind_wave_height",
  "wind_wave_period",
  "wind_wave_direction",
];

export function partitionsAt(h: Hourly, i: number): OffshorePartition[] {
  const v = (k: string) => h[k]?.[i] ?? null;
  const out: OffshorePartition[] = [];
  const push = (kind: "swell" | "wind", label: string, H: number | null, T: number | null, D: number | null) => {
    if (H !== null && T !== null && D !== null && H > 0.05 && T > 0) out.push({ kind, label, Hs: H, T, dir: D });
  };
  push("swell", "Primary swell", v("swell_wave_height"), v("swell_wave_peak_period") ?? v("swell_wave_period"), v("swell_wave_direction"));
  push("swell", "Secondary swell", v("secondary_swell_wave_height"), v("secondary_swell_wave_period"), v("secondary_swell_wave_direction"));
  push("wind", "Wind sea", v("wind_wave_height"), v("wind_wave_period"), v("wind_wave_direction"));
  return out;
}

export async function fetchForecast(days = 7, pastDays = 0): Promise<{ hours: HourInput[]; windError: string | null }> {
  const [off, near] = await Promise.all([
    getHourly(MARINE, OFFSHORE_POINT, OFFSHORE_VARS, days, pastDays),
    getHourly(MARINE, NEAR_POINT, ["wave_height", "sea_level_height_msl"], days, pastDays),
  ]);
  let wind: Hourly | null = null;
  let windError: string | null = null;
  try {
    wind = await getHourly(FORECAST, WIND_POINT, ["wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"], days, pastDays);
  } catch (e) {
    windError = String(e);
  }
  const nearIdx = new Map(near.time.map((t, i) => [t, i]));
  const windIdx = new Map((wind?.time ?? []).map((t, i) => [t, i]));
  const hours: HourInput[] = off.time.map((time, i) => {
    const ni = nearIdx.get(time);
    const wi = windIdx.get(time);
    const ws = wi !== undefined ? wind!.wind_speed_10m[wi] : null;
    const wd = wi !== undefined ? wind!.wind_direction_10m[wi] : null;
    return {
      time,
      partitions: partitionsAt(off, i),
      offshoreHs: off.wave_height[i] ?? 0,
      nearHs: ni !== undefined ? near.wave_height[ni] : null,
      tide: (ni !== undefined ? near.sea_level_height_msl[ni] : 0) ?? 0,
      wind: ws !== null && wd !== null ? { speedKmh: ws, gustKmh: wind!.wind_gusts_10m[wi!] ?? ws, dirFrom: wd } : null,
    };
  });
  return { hours, windError };
}
