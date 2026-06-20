import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: '/marketing/',
  plugins: [react()],
  build: {
    outDir: '../marketing',
    emptyOutDir: true,
  },
  server: {
    // 127.0.0.1 + 5190: 5174 falls in a Windows-reserved port range (EACCES on ::1).
    host: '127.0.0.1',
    port: 5190,
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
  },
}));
