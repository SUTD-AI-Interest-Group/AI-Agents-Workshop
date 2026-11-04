import { defineConfig } from '@playwright/test'

// Local: runs against `npm run dev` (web :3000, API :8787). Deployed: BASE_URL=https://… BOARD_PIN=… npx playwright test
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:3000', viewport: { width: 1440, height: 900 } },
})
