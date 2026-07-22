import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Baked into the bundle at build time so a stale cached/deployed build is
// obvious at a glance (see src/components/BuildBadge.tsx) instead of
// silently showing old behavior.
function readBuildInfo() {
  try {
    const commit = execSync('git rev-parse --short HEAD').toString().trim()
    return { commit, builtAt: new Date().toISOString() }
  } catch {
    return { commit: 'unknown', builtAt: new Date().toISOString() }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  base: '/',
  define: {
    __BUILD_INFO__: JSON.stringify(readBuildInfo()),
  },
})
