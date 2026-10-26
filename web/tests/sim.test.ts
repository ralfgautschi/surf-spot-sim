import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { transfer, type TransferTable } from "../src/sim/transfer";
import { surfAtSpot, type Spot } from "../src/sim/surf";
import { celerity, deepWaterLength, G, wavenumber } from "../src/sim/waves";

const dataDir = new URL("../public/data/", import.meta.url);
const table = (id: string): TransferTable => JSON.parse(readFileSync(new URL(`transfer/${id}.json`, dataDir), "utf8"));

describe("waves", () => {
  it("matches deep and shallow water limits", () => {
    expect((2 * Math.PI) / wavenumber(12, 1000)).toBeCloseTo(deepWaterLength(12), -1);
    const { c, cg } = celerity(12, 0.5);
    expect(c / Math.sqrt(G * 0.5)).toBeCloseTo(1, 1);
    expect(cg / c).toBeCloseTo(1, 1);
  });
});

describe("transfer", () => {
  type Case = { spot: string; T: number; dir: number; sigma: number; K: number; localDir: number };
  const cases: Case[] = JSON.parse(readFileSync(new URL("./fixtures/transfer_cases.json", import.meta.url), "utf8"));
  it.each(cases)("matches the Python reference: $spot T=$T dir=$dir", (c) => {
    const r = transfer(table(c.spot), c.T, c.dir, c.sigma);
    expect(r.K).toBeCloseTo(c.K, 2);
    if (c.K > 0.05) expect(Math.abs(((r.dir - c.localDir + 540) % 360) - 180)).toBeLessThan(0.5);
  });
});

// A plane beach facing south: depth = 0.02 * distance offshore (below MSL), z0 = 2, tide 0.
function planeSpot(slope = 0.02): Spot {
  const step = 5,
    start = -100;
  const zLAT = Array.from({ length: 600 }, (_, i) => 2 - slope * (start + i * step));
  return { id: "plane", name: "Plane", facing: 180, x: 0, y: 0, ref: { x: 0, y: -500, s: 500, depth: 10 }, profile: { step, start, zLAT } };
}

describe("surf at a spot", () => {
  it("breaks a 1 m set wave in about 1.3 m of water", () => {
    const r = surfAtSpot(planeSpot(), [{ Hs: 1 / 1.27, T: 10, dir: 180 }], 2, 0, null);
    expect(r.set).not.toBeNull();
    expect(r.set!.depth).toBeGreaterThan(1.0);
    expect(r.set!.depth).toBeLessThan(2.0);
    expect(r.set!.H / r.set!.depth).toBeGreaterThanOrEqual(0.78);
    expect(r.peel).toBe("closeout");
  });

  it("on a plane beach the break distance from the shoreline does not depend on the tide", () => {
    const lo = surfAtSpot(planeSpot(), [{ Hs: 1, T: 12, dir: 180 }], 2, -1, null);
    const hi = surfAtSpot(planeSpot(), [{ Hs: 1, T: 12, dir: 180 }], 2, 1, null);
    expect(Math.abs(lo.set!.distance - hi.set!.distance)).toBeLessThan(15);
  });

  it("swell from the clockwise side of the facing direction peels right", () => {
    expect(surfAtSpot(planeSpot(), [{ Hs: 1, T: 12, dir: 200 }], 2, 0, null).peel).toBe("right");
    expect(surfAtSpot(planeSpot(), [{ Hs: 1, T: 12, dir: 160 }], 2, 0, null).peel).toBe("left");
  });

  it("long period on a steeper slope plunges, short period on a gentle slope spills", () => {
    expect(surfAtSpot(planeSpot(0.05), [{ Hs: 1, T: 14, dir: 180 }], 2, 0, null).breaker).toBe("plunging");
    expect(surfAtSpot(planeSpot(0.01), [{ Hs: 1, T: 6, dir: 180 }], 2, 0, null).breaker).toBe("spilling");
  });

  it("reads the wind relative to the spot", () => {
    const parts = [{ Hs: 1, T: 12, dir: 180 }];
    expect(surfAtSpot(planeSpot(), parts, 2, 0, { speedKmh: 15, gustKmh: 20, dirFrom: 0 }).surface).toBe("offshore");
    expect(surfAtSpot(planeSpot(), parts, 2, 0, { speedKmh: 35, gustKmh: 45, dirFrom: 180 }).surface).toBe("blown out");
    expect(surfAtSpot(planeSpot(), parts, 2, 0, { speedKmh: 2, gustKmh: 4, dirFrom: 180 }).surface).toBe("glassy");
  });

  it("Luz: a 200° swell is much bigger at the spots than a 280° swell", () => {
    for (const id of ["fortaleza", "chico-times", "rocha-negra"]) {
      const s = transfer(table(id), 12, 200, 15).K;
      const w = transfer(table(id), 12, 280, 15).K;
      expect(w).toBeLessThan(0.25 * s);
    }
  });
});
