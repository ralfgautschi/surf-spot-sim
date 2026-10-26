import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { drawCrests, drawSpots, LUZ_VIEW, renderSeabed } from "../anim/bay";
import { loadBayGrid, traceFan, type BayGrid, type RayFan } from "../anim/bayrays";
import { buildProfileModel, drawProfile, ProfileSim } from "../anim/profile";
import { hashString, synthesize } from "../anim/sets";
import type { HourInput } from "../data/openmeteo";
import type { SimData } from "../sim/forecast";
import type { HourResult } from "./App";
import { sizeRange } from "./format";

const BAY_SPEED = 6; // bay view runs faster than real time so crests visibly move

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

export function AnimationPanel({ data, hour, result }: { data: SimData; hour: HourInput; result: HourResult }) {
  const spots = data.spots.spots;
  const [tab, setTab] = useState<string>(spots[1]?.id ?? "bay");
  const [playing, setPlaying] = useState(true);
  const [bay, setBay] = useState<BayGrid | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    loadBayGrid().then(setBay).catch(() => setBay(null));
  }, []);

  // Side-view model for the selected spot and hour
  const profile = useMemo(() => {
    const spot = spots.find((s) => s.id === tab);
    if (!spot) return null;
    const r = result[spot.id];
    const comps = synthesize(r.parts, hashString(hour.time + spot.id));
    return { spot, r, sim: new ProfileSim(buildProfileModel(spot, comps, data.spots.z0, hour.tide, r.breaker)) };
  }, [tab, hour, result]);

  // Bay-view ray fans for each swell partition worth drawing
  const fans = useMemo<{ fan: RayFan; Hs: number }[]>(() => {
    if (!bay || tab !== "bay") return [];
    return hour.partitions
      .filter((p) => p.Hs >= 0.2 && p.T >= 5)
      .slice(0, 2)
      .map((p) => ({ fan: traceFan(bay, p.T, p.dir, hour.tide), Hs: p.Hs }));
  }, [bay, tab, hour]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let seabed: ImageData | null = null;
    let seabedKey = "";
    const colors = Object.fromEntries(spots.map((s) => [s.id, cssVar(`--${s.id}`)]));
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (playing) t += dt;
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const h = tab === "bay" ? Math.round(w * 0.62) : Math.max(220, Math.round(w * 0.42));
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (tab === "bay") {
        if (!bay) {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = cssVar("--muted");
          ctx.fillText("Loading seabed…", 12, 20);
        } else {
          const key = `${w}x${h}:${hour.tide.toFixed(2)}:${dark}`;
          if (key !== seabedKey) {
            seabed = renderSeabed(bay, LUZ_VIEW, Math.round(w * dpr), Math.round(h * dpr), hour.tide, dark);
            seabedKey = key;
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.putImageData(seabed!, 0, 0);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const style = { land: cssVar("--land"), ink: cssVar("--ink"), foam: "#ffffff" };
          for (const f of fans) drawCrests(ctx, f.fan, f.Hs, LUZ_VIEW, w, h, t * BAY_SPEED, style);
          const labels = Object.fromEntries(spots.map((s) => [s.id, sizeRange(result[s.id])]));
          drawSpots(ctx, spots, labels, colors, LUZ_VIEW, w, h, style);
        }
      } else if (profile) {
        if (playing) profile.sim.step(t, dt);
        const xMax = Math.min(400, Math.max(150, (profile.r.set?.distance ?? 60) * 2.5));
        drawProfile(ctx, w, h, profile.sim, {
          sea: cssVar("--sea"),
          seaSoft: cssVar("--sea-soft"),
          foam: "#ffffff",
          sand: cssVar("--sand"),
          ink: cssVar("--ink"),
          muted: cssVar("--muted"),
          accent: colors[profile.spot.id],
        }, xMax, `${profile.spot.name}: ${sizeRange(profile.r)}, tide ${hour.tide >= 0 ? "+" : ""}${hour.tide.toFixed(1)} m`);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tab, profile, fans, bay, playing, hour]);

  return (
    <section class="panel">
      <h2>Simulation</h2>
      <div class="tabs" role="group" aria-label="View">
        <button aria-pressed={tab === "bay"} onClick={() => setTab("bay")}>Bay</button>
        {spots.map((s) => (
          <button aria-pressed={tab === s.id} onClick={() => setTab(s.id)}>{s.name}</button>
        ))}
        <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? "❚❚" : "▶"}</button>
      </div>
      <canvas ref={canvas} />
      <p class="note">
        {tab === "bay"
          ? `Swell crests traced from the open ocean over the seabed (×${BAY_SPEED} speed). White = breaking.`
          : "Side view from the beach (left) out to sea, real time, vertical scale exaggerated. Sets and lulls come from the swell's spectrum."}
      </p>
    </section>
  );
}
