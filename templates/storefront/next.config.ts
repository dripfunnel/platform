import type { NextConfig } from 'next'

// Read by local `next dev` and the template's own build only; shipped builds run in the sandbox (LIVE-SHOP §4).
const dev = process.env.NODE_ENV === 'development'
// A store repo's generated .env.development names its own shop (create.ts); without it /shop-api isn't proxied.
const shopApiProxy = process.env['SHOP_API_PROXY']

const config: NextConfig = {
  // Rewrites don't run under a static export, so the export is for `next build` only.
  ...(!dev && { output: 'export' }),
  // Core's routeAddresses end every route with a slash.
  trailingSlash: true,
  images: { unoptimized: true },
  ...(dev &&
    shopApiProxy && {
      async rewrites() {
        return [{ source: '/shop-api/:path*', destination: `${shopApiProxy}/shop-api/:path*` }]
      },
    }),
}

export default config
