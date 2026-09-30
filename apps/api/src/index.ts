import { adminSchema } from '#apis/admin/schema'
import { createServer } from '#apis/graphql/server'
import { handleHealthCheck, isHealthPath } from '#apis/health'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'
import { parseConfig } from '#core/config'
import { resolveArea } from './router'

const servers = {
  admin: createServer(adminSchema, '/api'),
  platform: createServer(platformSchema, '/api'),
  store: createServer(storeSchema, '/api'),
  shop: createServer(shopSchema, '/shop-api'),
}

const notFound = () => new Response('Not found', { status: 404 })

interface Env extends Record<string, unknown> {
  HEALTH_RATE_LIMITER: RateLimit
  CF_VERSION_METADATA: { id: string; tag: string }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    let config
    try {
      config = parseConfig(env)
    } catch {
      console.error(JSON.stringify({ code: 'config_invalid' }))
      return new Response(null, { status: 500 })
    }
    const area = resolveArea(url, config)
    if (!area || area === 'hooks') return notFound()
    if (isHealthPath(area, url.pathname))
      return handleHealthCheck(request, area, config, ctx, env.HEALTH_RATE_LIMITER, env.CF_VERSION_METADATA.id)
    return servers[area].fetch(request)
  },
} satisfies ExportedHandler<Env>
