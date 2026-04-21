import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  // CI (e.g. GitHub Actions) injects secrets as process.env; loadEnv only reads .env files.
  const openRouteKey = process.env.OPENROUTE_KEY ?? fileEnv.OPENROUTE_KEY ?? ''
  const traveltimeAppId = process.env.TRAVELTIME_APP_ID ?? fileEnv.TRAVELTIME_APP_ID ?? ''
  const traveltimeApiKey = process.env.TRAVELTIME_API_KEY ?? fileEnv.TRAVELTIME_API_KEY ?? ''
  return {
    // GitHub project site: https://<user>.github.io/<repo>/
    base: process.env.GITHUB_ACTIONS ? '/fp3/' : '/',
    plugins: [react()],
    define: {
      'import.meta.env.VITE_OPENROUTE_KEY': JSON.stringify(openRouteKey),
      'import.meta.env.VITE_TRAVELTIME_APP_ID': JSON.stringify(traveltimeAppId),
      'import.meta.env.VITE_TRAVELTIME_API_KEY': JSON.stringify(traveltimeApiKey),
    },
  }
})
