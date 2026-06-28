import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import path from "node:path";

const cesiumSource = "node_modules/cesium/Build/Cesium";
// Preserve the mapped-drive path on Windows/VMware shared folders. If Rolldown
// realpaths back to `\\vmware-host\Shared Folders`, the space in the share
// name can be mangled into an invalid `Y: Folders/...` HTML entry path.
const htmlEntry = path.resolve(__dirname, "index.html").replace(/\\/g, "/");

// Tauri runs the frontend at a fixed port; mobile dev gets a hostname env var.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ command, mode }) => {
  // Guard against shipping a personal Cesium ion token: Vite statically inlines
  // every VITE_-prefixed var into the client bundle, so a token left in .env
  // during `tauri build` would be baked into the installer handed to end users
  // (leaking the credential + burning its free-tier quota). The desktop app
  // reads the token from the in-app Settings store instead. Local release
  // builds should leave VITE_CESIUM_TOKEN unset or explicitly empty.
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "");
    if (env.VITE_CESIUM_TOKEN && env.VITE_CESIUM_TOKEN.trim() && !process.env.ALLOW_TOKEN_IN_BUNDLE) {
      throw new Error(
        "VITE_CESIUM_TOKEN is set and would be inlined into the distributable bundle.\n" +
          "Unset it for production builds (the desktop app reads the token from the in-app\n" +
          "Settings store), or set ALLOW_TOKEN_IN_BUNDLE=1 to override intentionally.",
      );
    }
  }
  return {
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/Workers`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cesiumSource}/ThirdParty`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Assets`, dest: "cesium", rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Widgets`, dest: "cesium", rename: { stripBase: 4 } },
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
    target: ["es2022", "chrome105", "safari15"],
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    chunkSizeWarningLimit: 4000, // Cesium ships a big bundle
    rolldownOptions: {
      input: htmlEntry,
      output: {
        codeSplitting: {
          groups: [
            { name: "cesium", test: /node_modules\/cesium/ },
            { name: "react-vendor", test: /node_modules\/(react|scheduler)/ },
          ],
        },
      },
    },
  },
  };
});
