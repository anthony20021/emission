import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const SERVER = `http://localhost:${process.env.PORT || 3000}`;

export default defineConfig({
  root: 'client',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true, // accessible depuis les autres machines du réseau local
    port: 5173,
    proxy: {
      '/socket.io': { target: SERVER, ws: true },
      '/media': SERVER,
      '/api': SERVER,
    },
  },
});
