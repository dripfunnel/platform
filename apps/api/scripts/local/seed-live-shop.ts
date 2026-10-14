import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import { z } from 'zod'
import type { R2Bucket } from '@cloudflare/workers-types'
import { seedLiveShop } from './live-shop'

// `pnpm --filter ./apps/api seed:live-shop <store id or code>`: puts a stand-in site live on the store's own address.
const env = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env)
const store = process.argv[2]
if (!store) throw new Error('Usage: seed:live-shop <store id or code>')
const core = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../../packages/storefront-core/package.json', import.meta.url)), 'utf8')) as { version: string }).version

const proxy = await getPlatformProxy<{ STOREFRONT_SITES: R2Bucket }>({ environment: 'local' })
try {
  const live = await seedLiveShop({ databaseUrl: env.DATABASE_URL, sites: proxy.env.STOREFRONT_SITES, store, core })
  console.log(`Stand-in site live for ${live.name} (${live.storeId}) as build ${live.buildId}.`)
  console.log(live.address ? `Open https://${live.address} (pnpm dev:https and pnpm dev:proxy running; the address may answer 404 for up to a minute).` : 'No address serves this store yet: its partner has no usable shops domain.')
} finally {
  await proxy.dispose()
}
