import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pin the dev/preview port so the app is always served from the SAME origin
  // (http://localhost:5183). localStorage is per-origin, so a drifting port
  // would look like an empty library. strictPort fails loudly instead of
  // silently picking another port.
  server: { port: 5183, strictPort: true },
  preview: { port: 5183, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
