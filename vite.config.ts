import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "node:path";

const cesiumSource = "node_modules/cesium/Build/Cesium";
// Preserve the mapped-drive path on Windows/VMware shared folders. If Rollup
// realpaths back to `\\vmware-host\Shared Folders`, the space in the share
// name can be mangled into an invalid `Y: Folders/...` HTML entry path.
const htmlEntry = path.resolve(__dirname, "index.html").replace(/\\/g, "/");

// Tauri runs the frontend at a fixed port; mobile dev gets a hostname env var.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/Workers`, dest: "cesium" },
        { src: `${cesiumSource}/ThirdParty`, dest: "cesium" },
        { src: `${cesiumSource}/Assets`, dest: "cesium" },
        { src: `${cesiumSource}/Widgets`, dest: "cesium" },
      ],
    }),
  ],
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    // Tell CesiumJS where to load its workers from at runtime.
    CESIUM_BASE_URL: JSON.stringify("/cesium"),
  },

  // Prevent Vite from obscuring Rust errors during `tauri dev`.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: ["es2022", "chrome105", "safari13"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    chunkSizeWarningLimit: 4000, // Cesium ships a big bundle
    rollupOptions: {
      input: htmlEntry,
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/cesium")) return "cesium";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
}));
