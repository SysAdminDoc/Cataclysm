import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesiumPlugin from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [react(), (cesiumPlugin as any)()],
});
