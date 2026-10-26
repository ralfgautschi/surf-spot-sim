import { useEffect, useMemo, useState } from "preact/hooks";
import { fetchForecast, type HourInput } from "../data/openmeteo";
import { loadSimData, simulateHour, type SimData } from "../sim/forecast";
import { AnimationPanel } from "./AnimationPanel";
import { compass, dayLabel, hhmm } from "./format";
import { HourTable } from "./HourTable";
import { SpotCard } from "./SpotCard";

export type HourResult = ReturnType<typeof simulateHour>;

export function App() {
  const [data, setData] = useState<SimData | null>(null);
  const [hours, setHours] = useState<HourInput[]>([]);
  const [windError, setWindError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState(0);
  const [hourIdx, setHourIdx] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([loadSimData(), fetchForecast(7)])
      .then(([d, f]) => {
        setData(d);
        setHours(applyWhatIf(f.hours, new URLSearchParams(location.search)));
        setWindError(f.windError);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const results = useMemo<HourResult[]>(() => (data ? hours.map((h) => simulateHour(data, h)) : []), [data, hours]);
  const days = useMemo(() => [...new Set(hours.map((h) => h.time.slice(0, 10)))], [hours]);
  const dayHours = useMemo(
    () => hours.map((h, i) => ({ h, i })).filter(({ h }) => h.time.slice(0, 10) === days[day]),
    [hours, days, day],
  );

  // Default hour: now (rounded) on today, 08:00 on other days.
  useEffect(() => {
    if (!dayHours.length) return;
    const now = new Date();
    const target = day === 0 ? `${String(now.getHours()).padStart(2, "0")}:00` : "08:00";
    const m = dayHours.find(({ h }) => hhmm(h.time) === target) ?? dayHours[0];
    setHourIdx(m.i);
  }, [day, dayHours.length]);

  if (error) return <main><h1>Luz Surf Sim</h1><p class="err">Could not load: {error}</p></main>;
  if (!data || hourIdx === null || !results.length) return <main><h1>Luz Surf Sim</h1><p class="sub">Loading forecast…</p></main>;

  const hour = hours[hourIdx];
  const res = results[hourIdx];
  const first = dayHours[0]?.i ?? 0;
  const last = dayHours[dayHours.length - 1]?.i ?? 0;

  return (
    <main>
      <h1>Luz Surf Sim</h1>
      <p class="sub">How the offshore swell turns into waves at each spot of Praia da Luz: ray tracing over the seabed, shoaling and breaking.</p>

      <div class="days" role="group" aria-label="Day">
        {days.map((d, i) => (
          <button aria-pressed={i === day} onClick={() => setDay(i)}>{dayLabel(d)}</button>
        ))}
      </div>
      <div class="slider">
        <span class="time">{hhmm(hour.time)}</span>
        <input type="range" min={first} max={last} value={hourIdx} aria-label="Hour"
          onInput={(e) => setHourIdx(Number((e.target as HTMLInputElement).value))} />
      </div>

      <section class="panel">
        <h2>Offshore (open ocean SW of Sagres)</h2>
        <div class="offshore">
          {hour.partitions.length === 0 && <div class="stat">No swell</div>}
          {hour.partitions.map((p) => (
            <div class="stat">
              {p.label}
              <b>
                {p.Hs.toFixed(1)} m · {p.T.toFixed(0)} s · <Arrow dir={p.dir} /> {compass(p.dir)} {Math.round(p.dir)}°
              </b>
            </div>
          ))}
          <div class="stat">
            Wind at Luz
            <b>{hour.wind ? <>{Math.round(hour.wind.speedKmh)} km/h <Arrow dir={hour.wind.dirFrom} /> {compass(hour.wind.dirFrom)} (gusts {Math.round(hour.wind.gustKmh)})</> : "unavailable"}</b>
          </div>
          <div class="stat">
            Tide (vs mean sea level)
            <b>{hour.tide >= 0 ? "+" : ""}{hour.tide.toFixed(2)} m</b>
          </div>
          <div class="stat">
            Coarse model near Luz says
            <b>{hour.nearHs !== null ? `${hour.nearHs.toFixed(1)} m` : "–"}</b>
          </div>
        </div>
        {windError && <p class="note">Wind data could not be loaded ({windError}); surface conditions are not shown.</p>}
      </section>

      <section class="spots">
        {data.spots.spots.map((s) => <SpotCard spot={s} r={res[s.id]} />)}
      </section>

      <AnimationPanel data={data} hour={hour} result={res} />

      <section class="panel">
        <h2>Hour by hour</h2>
        <HourTable spots={data.spots.spots} rows={dayHours.map(({ h, i }) => ({ i, time: h.time, r: results[i], tide: h.tide }))} selected={hourIdx} onSelect={setHourIdx} />
      </section>

      <p class="note">
        Data: Open-Meteo marine and weather forecasts; seabed from EMODnet Bathymetry (DTM 2022 and 2011 Algarve LiDAR, CC-BY 4.0).
        Spot pins are provisional. Sizes are breaking face heights; "sets" ≈ the bigger waves (H1/10).
      </p>
    </main>
  );
}

/**
 * "What if" overrides from the URL, e.g. ?swell=1.5,12,215&wind=10,20&tide=0.5
 * swell = Hs (m), period (s), direction from (deg); wind = km/h, direction from; tide = m vs MSL.
 */
function applyWhatIf(hours: HourInput[], q: URLSearchParams): HourInput[] {
  const nums = (k: string) => q.get(k)?.split(",").map(Number).filter((v) => isFinite(v)) ?? [];
  const sw = nums("swell"),
    wi = nums("wind"),
    ti = nums("tide");
  if (!sw.length && !wi.length && !ti.length) return hours;
  return hours.map((h) => ({
    ...h,
    partitions: sw.length === 3 ? [{ kind: "swell", label: "What-if swell", Hs: sw[0], T: sw[1], dir: sw[2] }] : h.partitions,
    wind: wi.length === 2 ? { speedKmh: wi[0], gustKmh: wi[0] * 1.3, dirFrom: wi[1] } : h.wind,
    tide: ti.length === 1 ? ti[0] : h.tide,
  }));
}

export function Arrow({ dir }: { dir: number }) {
  // ↓ rotated by the "from" direction points the way the waves/wind travel
  return <span class="arrow" style={{ transform: `rotate(${dir}deg)` }} aria-hidden="true">↓</span>;
}
