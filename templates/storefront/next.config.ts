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
  // `*.dev.ts` files exist only under next dev: the theme's images' route (src/app/theme-media, #1405).
  pageExtensions: dev ? ['dev.ts', 'tsx', 'ts', 'jsx', 'js'] : ['tsx', 'ts', 'jsx', 'js'],
  // A theme's CSS url(<asset id>) and url(media/<name>), which a build's bundler maps itself (storefront ARCHITECTURE §3.4).
  ...(dev && { turbopack: { rules: { '*.module.css': { loaders: ['./asset-url-loader.mjs'], as: '*.module.css' } } } }),
  ...(dev &&
    shopApiProxy && {
      async rewrites() {
        return [{ source: '/shop-api/:path*', destination: `${shopApiProxy}/shop-api/:path*` }]
      },
    }),
}

export default config
