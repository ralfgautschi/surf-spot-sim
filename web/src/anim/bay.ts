// Top-down bay view: shaded seabed, moving swell crests from forward rays, foam where they break, spot pins.
import { GAMMA, SET_FACTOR, type Spot } from "../sim/surf";
import { depthAt, shoal, type BayGrid, type RayFan } from "./bayrays";

export interface View {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export const LUZ_VIEW: View = { xmin: -3500, xmax: 6500, ymin: -6500, ymax: 1200 };

export interface BayStyle {
  land: string;
  ink: string;
  foam: string;
}

/** Pre-render the seabed shading for the view (recomputed when the size or tide changes). */
export function renderSeabed(g: BayGrid, view: View, w: number, h: number, tide: number, dark: boolean): ImageData {
  const img = new ImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const x = view.xmin + ((px + 0.5) / w) * (view.xmax - view.xmin);
      const y = view.ymax - ((py + 0.5) / h) * (view.ymax - view.ymin);
      const d = depthAt(g, x, y, tide);
      const k = 4 * (py * w + px);
      if (!(d > 0)) {
        // land: sand near the waterline, darker cliffs inland
        const up = Math.min(1, Math.max(0, -d / 40));
        const [r, gg, b] = dark ? [107 - 50 * up, 93 - 45 * up, 63 - 30 * up] : [232 - 80 * up, 217 - 85 * up, 181 - 90 * up];
        img.data.set([r, gg, b, 255], k);
      } else {
        const t = Math.min(1, Math.sqrt(d / 60));
        const [r, gg, b] = dark ? [22 - 12 * t, 70 - 40 * t, 105 - 35 * t] : [200 - 150 * t, 228 - 120 * t, 240 - 70 * t];
        img.data.set([r, gg, b, 255], k);
      }
    }
  }
  return img;
}

/**
 * Draw the crests of one ray fan at time t. A crest is where (phase - t/T) is an integer; neighbouring rays'
 * crest points are joined. Brightness follows the local height (shoaling + ray spreading); white where it breaks.
 */
export function drawCrests(ctx: CanvasRenderingContext2D, fan: RayFan, Hs: number, view: View, w: number, h: number, t: number, style: BayStyle) {
  const sx = w / (view.xmax - view.xmin),
    sy = h / (view.ymax - view.ymin);
  const PX = (x: number) => (x - view.xmin) * sx,
    PY = (y: number) => (view.ymax - y) * sy;
  const shift = t / fan.T;
  // For each ray: map crest index -> point
  const pts: Map<number, [number, number, number]>[] = fan.rays.map((r) => {
    const m = new Map<number, [number, number, number]>();
    for (let i = 1; i < r.n; i++) {
      const x = r.x[i],
        y = r.y[i];
      if (x < view.xmin - 500 || x > view.xmax + 500 || y < view.ymin - 500 || y > view.ymax + 500) continue;
      const a = r.phase[i - 1] - shift,
        b = r.phase[i] - shift;
      const ka = Math.floor(a),
        kb = Math.floor(b);
      if (kb > ka) {
        const f = (kb - a) / (b - a);
        m.set(kb, [r.x[i - 1] + f * (x - r.x[i - 1]), r.y[i - 1] + f * (y - r.y[i - 1]), r.depth[i - 1] + f * (r.depth[i] - r.depth[i - 1])]);
      }
    }
    return m;
  });
  ctx.lineCap = "round";
  for (let k = 0; k < pts.length - 1; k++) {
    for (const [idx, p] of pts[k]) {
      const q = pts[k + 1].get(idx);
      if (!q) continue;
      const seg = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (seg > 5 * fan.spacing) continue; // rays diverged around land: do not bridge
      const spread = Math.sqrt(fan.spacing / Math.max(seg, 1));
      const d = 0.5 * (p[2] + q[2]);
      const H = Hs * spread * shoal(fan.T, d);
      const breaking = SET_FACTOR * H >= GAMMA * d;
      const alpha = Math.min(1, 0.15 + H / 1.5);
      ctx.strokeStyle = breaking ? style.foam : `rgba(255,255,255,${0.35 * alpha})`;
      ctx.globalAlpha = breaking ? Math.min(1, 0.5 + H) : 1;
      ctx.lineWidth = breaking ? 3 : 1 + Math.min(2, H);
      ctx.beginPath();
      ctx.moveTo(PX(p[0]), PY(p[1]));
      ctx.lineTo(PX(q[0]), PY(q[1]));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

export function drawSpots(ctx: CanvasRenderingContext2D, spots: Spot[], labels: Record<string, string>, colors: Record<string, string>, view: View, w: number, h: number, style: BayStyle) {
  const PX = (x: number) => ((x - view.xmin) / (view.xmax - view.xmin)) * w,
    PY = (y: number) => ((view.ymax - y) / (view.ymax - view.ymin)) * h;
  ctx.font = "600 12px system-ui, sans-serif";
  spots.forEach((s, i) => {
    const x = PX(s.x),
      y = PY(s.y);
    ctx.fillStyle = colors[s.id];
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    // stagger labels so the three close pins stay readable
    const ly = y + 22 + i * 18;
    ctx.strokeStyle = colors[s.id];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 6);
    ctx.lineTo(x, ly - 10);
    ctx.stroke();
    ctx.fillStyle = style.ink;
    ctx.fillText(`${s.name} ${labels[s.id] ?? ""}`, x - 20, ly);
  });
  // north arrow + scale
  ctx.fillStyle = style.ink;
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("N ↑", w - 34, 18);
  const km = w / ((view.xmax - view.xmin) / 1000);
  ctx.fillRect(10, h - 12, km, 2);
  ctx.fillText("1 km", 12, h - 16);
}
