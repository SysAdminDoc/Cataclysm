import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesiumPlugin from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [react(), (cesiumPlugin as any)()],
  server: {
    proxy: {
      '/api/jpl': {
        target: 'https://ssd-api.jpl.nasa.gov',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/jpl/, ''),
      },
    },
  },
});
