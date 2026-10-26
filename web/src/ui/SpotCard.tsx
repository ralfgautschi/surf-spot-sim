import type { Spot, SpotResult } from "../sim/surf";
import { Arrow } from "./App";
import { BREAKER_TEXT, compass, ft, sizeRange, surfaceClass } from "./format";

type Parts = { label: string; K: number; Hs: number; T: number; dir: number }[];

export function SpotCard({ spot, r }: { spot: Spot; r: SpotResult & { parts: Parts } }) {
  const flat = !r.set || r.set.H < 0.15;
  const peelText = r.peel === "closeout" ? "closing out" : r.peel === "none" ? "–" : `peeling ${r.peel}s`;
  return (
    <article class="panel spot" style={{ "--c": `var(--${spot.id})` }}>
      <h3>{spot.name}</h3>
      <div class="big">
        {sizeRange(r)} {!flat && <small>({r.typical!.H.toFixed(1)}–{r.set!.H.toFixed(1)} m)</small>}
      </div>
      <div class="tags">
        <span class="tag">{BREAKER_TEXT[r.breaker]}</span>
        {!flat && <span class="tag">{peelText}</span>}
        {r.surface !== "unknown" && <span class={`tag ${surfaceClass(r.surface)}`}>{r.surface}</span>}
      </div>
      <table class="details">
        <tbody>
          {!flat && (
            <tr>
              <td>Sets break</td>
              <td>{Math.round(r.set!.distance)} m out, in {r.set!.depth.toFixed(1)} m of water</td>
            </tr>
          )}
          <tr>
            <td>At 10 m depth</td>
            <td>
              {r.HsRef.toFixed(2)} m from <Arrow dir={r.dirLocal} /> {compass(r.dirLocal)} {isFinite(r.dirLocal) ? `${Math.round(r.dirLocal)}°` : ""}
            </td>
          </tr>
          {r.parts.map((p) => (
            <tr>
              <td>{p.label}</td>
              <td>{Math.round(p.K * 100)}% of offshore height gets here</td>
            </tr>
          ))}
          {r.surface !== "unknown" && (
            <tr>
              <td>Wind</td>
              <td>
                {r.onshoreKmh >= 0 ? `${Math.round(r.onshoreKmh)} km/h onshore` : `${Math.round(-r.onshoreKmh)} km/h offshore`}, {Math.round(r.crossKmh)} cross
              </td>
            </tr>
          )}
          <tr>
            <td>Faces</td>
            <td>{compass(spot.facing)} ({Math.round(spot.facing)}°)</td>
          </tr>
        </tbody>
      </table>
      {flat && r.HsRef > 0 && <p class="note">Only {ft(r.HsRef).toFixed(1)} ft of swell reaches 10 m depth here.</p>}
    </article>
  );
}
