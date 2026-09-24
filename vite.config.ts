import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// The dev server (and its /api proxy to the embedded server) is started by electron/scripts/dev.ts
export default defineConfig({
  plugins: [react()],
})
