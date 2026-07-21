import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';

// En Docker no hay .git ni binario git → el CI inyecta COMMIT_HASH como build arg.
const commitHash = (() => {
  if (process.env.COMMIT_HASH) return process.env.COMMIT_HASH.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy API requests al backend
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy WebSocket
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
