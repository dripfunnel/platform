import { createServer } from '#apis/graphql/server'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'
import { parseConfig } from '#core/config'
import { resolveArea } from './router'

const servers = {
  platform: createServer(platformSchema, '/api'),
  store: createServer(storeSchema, '/api'),
  shop: createServer(shopSchema, '/shop-api'),
}

const notFound = () => new Response('Not found', { status: 404 })

export default {
  fetch(request, env) {
    const url = new URL(request.url)
    const area = resolveArea(url, parseConfig(env))
    if (!area || area === 'hooks') return notFound()
    if (url.pathname.endsWith('/health')) return Response.json({ ok: true, area })
    return servers[area].fetch(request)
  },
} satisfies ExportedHandler<Record<string, unknown>>
