import type { NextConfig } from 'next'

// Static export: the Cloudflare Worker serves `out/` as assets and owns every /api, /crew and /mcp route.
const config: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  reactStrictMode: true,
}

export default config
