import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The local API (npm run server) serves real clubs and players.
  server: { proxy: { '/api': 'http://localhost:8787' } },
});
