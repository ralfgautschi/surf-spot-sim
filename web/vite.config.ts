import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base "./" so the build works from any path (e.g. GitHub Pages /surf-spot-sim/)
export default defineConfig({
  base: "./",
  plugins: [preact()],
  test: { environment: "node" },
} as any);
