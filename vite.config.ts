import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Set base to your GitHub repo name, e.g. '/choice-ev-map/'
// Override with VITE_BASE_PATH env var if needed
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || '/choice-ev-map/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
