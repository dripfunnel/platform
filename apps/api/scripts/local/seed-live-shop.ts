import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import type { R2Bucket } from '@cloudflare/workers-types'
import { seedLiveShop } from './live-shop'

// `pnpm --filter ./apps/api seed:live-shop <store id or code> [--draft]`: puts a stand-in site, or with --draft a copy of the studio's current preview, live on the store's own address.
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)
const draft = process.argv.includes('--draft')
const store = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!store) throw new Error('Usage: seed:live-shop <store id or code> [--draft]')
const core = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../../packages/storefront-core/package.json', import.meta.url)), 'utf8')) as { version: string }).version

const proxy = await getPlatformProxy<{ STOREFRONT_SITES: R2Bucket }>({ environment: 'local' })
try {
  const live = await seedLiveShop({ databaseUrl: env.DATABASE_URL, sites: proxy.env.STOREFRONT_SITES, store, core, draft, ...(process.env['SANDBOX_LOCAL_URL'] ? { sandboxUrl: process.env['SANDBOX_LOCAL_URL'] } : {}) })
  console.log(`${draft ? 'Draft preview copied live' : 'Stand-in site live'} for ${live.name} (${live.storeId}) as build ${live.buildId}.`)
  console.log(live.address ? `Open https://${live.address} (pnpm dev:https and pnpm dev:proxy running; the address may answer 404 for up to a minute).` : 'No address serves this store yet: its partner has no usable shops domain.')
} finally {
  await proxy.dispose()
}
