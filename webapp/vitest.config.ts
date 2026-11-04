import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { BOARD_PIN: '123456', SESSION_SECRET: 'test-secret' } },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
})
