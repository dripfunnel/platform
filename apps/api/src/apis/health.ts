import type { Config } from '#core/config'
import { checkHealth } from '#db/health'
import type { Area } from '../router'

const healthPath = { admin: '/api/health', platform: '/api/health', store: '/api/health', shop: '/shop-api/health' } as const

interface RateLimiter {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

interface WaitUntil {
  waitUntil: (promise: Promise<unknown>) => void
}

export const isHealthPath = (area: Exclude<Area, 'hooks'>, pathname: string): boolean => pathname === healthPath[area]

export const handleHealthCheck = async (
  request: Request,
  area: Exclude<Area, 'hooks'>,
  config: Config,
  ctx: WaitUntil,
  rateLimiter: RateLimiter,
  version: string,
): Promise<Response> => {
  const ip = request.headers.get('cf-connecting-ip')
  if (!ip) return new Response('Bad request', { status: 400 })
  const { success } = await rateLimiter.limit({ key: `${area}:${ip}` })
  if (!success) return new Response('Too many requests', { status: 429 })
  const db = await checkHealth(config, ctx)
  const ok = db !== 'down'
  return Response.json({ ok, area, db, version }, { status: ok ? 200 : 503 })
}
