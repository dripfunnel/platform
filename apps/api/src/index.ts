import { adminSchema } from '#apis/admin/schema'
import { createServer } from '#apis/graphql/server'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'
import { parseConfig } from '#core/config'
import { checkHealth } from '#db/health'
import { resolveArea } from './router'

const servers = {
  admin: createServer(adminSchema, '/api'),
  platform: createServer(platformSchema, '/api'),
  store: createServer(storeSchema, '/api'),
  shop: createServer(shopSchema, '/shop-api'),
}

const notFound = () => new Response('Not found', { status: 404 })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const config = parseConfig(env)
    const area = resolveArea(url, config)
    if (!area || area === 'hooks') return notFound()
    if (url.pathname.endsWith('/health')) return Response.json({ ok: await checkHealth(config), area })
    return servers[area].fetch(request)
  },
} satisfies ExportedHandler<Record<string, unknown>>
