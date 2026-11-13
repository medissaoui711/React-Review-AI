import { defineConfig } from "vite";

// Static Cloudflare Pages build. Keep this separate from vite.config.ts,
// which configures the Cloudflare Worker/MCP runtime.
export default defineConfig({
  configFile: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
