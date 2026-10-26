// Ties the pieces together: offshore hour -> per-spot result.
import type { HourInput } from "../data/openmeteo";
import { spreadDeg, transfer, type TransferTable } from "./transfer";
import { surfAtSpot, type LocalPartition, type Spot, type SpotResult } from "./surf";

export interface SpotsFile {
  origin: { lat: number; lon: number };
  z0: number;
  spots: Spot[];
}

export interface SimData {
  spots: SpotsFile;
  tables: Record<string, TransferTable>;
}

export async function loadSimData(base = "./data"): Promise<SimData> {
  const spots: SpotsFile = await (await fetch(`${base}/spots.json`)).json();
  const tables: Record<string, TransferTable> = {};
  await Promise.all(
    spots.spots.map(async (s) => {
      tables[s.id] = await (await fetch(`${base}/transfer/${s.id}.json`)).json();
    }),
  );
  return { spots, tables };
}

export function localPartitions(table: TransferTable, hour: HourInput): (LocalPartition & { label: string; K: number })[] {
  return hour.partitions.map((p) => {
    const { K, dir } = transfer(table, p.T, p.dir, spreadDeg(p.T, p.kind));
    return { label: p.label, K, Hs: p.Hs * K, T: p.T, dir };
  });
}

export function simulateHour(data: SimData, hour: HourInput): Record<string, SpotResult & { parts: ReturnType<typeof localPartitions> }> {
  const out: Record<string, SpotResult & { parts: ReturnType<typeof localPartitions> }> = {};
  for (const spot of data.spots.spots) {
    const parts = localPartitions(data.tables[spot.id], hour);
    out[spot.id] = { ...surfAtSpot(spot, parts, data.spots.z0, hour.tide, hour.wind), parts };
  }
  return out;
}
