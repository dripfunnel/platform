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

const healthPath = { admin: '/api/health', platform: '/api/health', store: '/api/health', shop: '/shop-api/health' } as const

const notFound = () => new Response('Not found', { status: 404 })

interface Env extends Record<string, unknown> {
  HEALTH_RATE_LIMITER: RateLimit
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const config = parseConfig(env)
    const area = resolveArea(url, config)
    if (!area || area === 'hooks') return notFound()
    if (url.pathname === healthPath[area]) {
      const ip = request.headers.get('cf-connecting-ip')
      if (!ip) return new Response('Bad request', { status: 400 })
      const { success } = await env.HEALTH_RATE_LIMITER.limit({ key: `${area}:${ip}` })
      if (!success) return new Response('Too many requests', { status: 429 })
      const ok = await checkHealth(config, ctx)
      return Response.json({ ok, area }, { status: ok ? 200 : 503 })
    }
    return servers[area].fetch(request)
  },
} satisfies ExportedHandler<Env>
