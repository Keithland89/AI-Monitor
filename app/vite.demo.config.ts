import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const appDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: resolve(appDir, 'demo'),
  base: '/demo/agent-monitor/',
  publicDir: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: './pages/Setup', replacement: resolve(appDir, 'src/pages/DemoSetup.tsx') },
      { find: '../data/static', replacement: resolve(appDir, 'src/data/demoStatic.ts') },
      { find: /^(?:\.{1,2}\/)?metrics\/coverage$/, replacement: resolve(appDir, 'src/metrics/demoCoverage.ts') },
    ],
  },
  build: {
    outDir: resolve(appDir, '..', 'demo', 'agent-monitor'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(appDir, 'demo', 'index.html'),
    },
  },
})
