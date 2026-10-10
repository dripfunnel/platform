import { isDevOrLocal, type Config } from '#core/config'
import { checkHealth } from '#db/health'
import type { Area } from '../router'

const healthPath = { admin: '/api/health', platform: '/api/health', store: '/api/health', shop: '/shop-api/health' } as const

interface RateLimiter {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

interface WaitUntil {
  waitUntil: (promise: Promise<unknown>) => void
}

type Presence = 'configured' | 'missing'

const presence = (...values: unknown[]): Presence => (values.every((value) => value !== undefined) ? 'configured' : 'missing')

export const integrationsOf = (config: Config, hasAssets: boolean) => ({
  entra: presence(config.ENTRA_TENANT_ID, config.ENTRA_CLIENT_ID, config.ENTRA_CLIENT_SECRET),
  stripe: presence(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET),
  ses: presence(config.SES_REGION, config.SES_ACCESS_KEY_ID, config.SES_SECRET_ACCESS_KEY, config.SES_SENDER_DOMAIN, config.EMAIL_SUPPRESSION_KEY),
  assets: hasAssets ? 'configured' : 'missing',
})

export const isHealthPath = (area: Exclude<Area, 'hooks'>, pathname: string): boolean => pathname === healthPath[area]

export const handleHealthCheck = async (
  request: Request,
  area: Exclude<Area, 'hooks'>,
  config: Config,
  ctx: WaitUntil,
  rateLimiter: RateLimiter,
  version: string,
  hasAssets: boolean,
): Promise<Response> => {
  const ip = request.headers.get('cf-connecting-ip')
  if (!ip) return new Response('Bad request', { status: 400 })
  const { success } = await rateLimiter.limit({ key: `${area}:${ip}` })
  if (!success) return new Response('Too many requests', { status: 429 })
  const db = await checkHealth(config, ctx)
  const ok = db === 'ok' || db === 'unconfigured'
  // Public, so integrations only where a missing value helps whoever sets the environment up (README §7).
  const body = { ok, area, db, version }
  return Response.json(isDevOrLocal(config) ? { ...body, integrations: integrationsOf(config, hasAssets) } : body, { status: ok ? 200 : 503 })
}
