import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the AI509 x HSF quiz SPA.
// JSON/PNG are importable out of the box; JSX handled by the react plugin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
});
