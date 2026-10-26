import type { Spot, SpotResult } from "../sim/surf";
import { ft, hhmm, sizeRange } from "./format";

interface Row {
  i: number;
  time: string;
  tide: number;
  r: Record<string, SpotResult>;
}

export function HourTable({ spots, rows, selected, onSelect }: { spots: Spot[]; rows: Row[]; selected: number; onSelect: (i: number) => void }) {
  const max = Math.max(1, ...rows.flatMap((row) => spots.map((s) => ft(row.r[s.id].set?.H ?? 0))));
  return (
    <div class="table-wrap">
      <table class="hours">
        <thead>
          <tr>
            <th>Time</th>
            <th>Tide</th>
            {spots.map((s) => (
              <th style={{ color: `var(--${s.id})` }}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows
            .filter((row) => {
              const h = Number(hhmm(row.time).slice(0, 2));
              return h >= 6 && h <= 21;
            })
            .map((row) => (
              <tr class={row.i === selected ? "sel" : ""} onClick={() => onSelect(row.i)}>
                <td>{hhmm(row.time)}</td>
                <td>{row.tide >= 0 ? "+" : ""}{row.tide.toFixed(1)}</td>
                {spots.map((s) => {
                  const r = row.r[s.id];
                  const w = (ft(r.set?.H ?? 0) / max) * 60;
                  return (
                    <td style={{ "--c": `var(--${s.id})` }}>
                      <span class="bar" style={{ width: `${Math.max(w, 2)}px` }} />
                      {sizeRange(r)}
                      {r.peel === "left" || r.peel === "right" ? ` ${r.peel === "left" ? "L" : "R"}` : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
