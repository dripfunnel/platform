import { z } from 'zod'
import type { HostStatus } from '#db/schema/saas'

const apiBase = 'https://api.cloudflare.com/client/v4'
const timeoutMs = 10_000

export class CloudflareUnavailable extends Error {}
export class CloudflareRefused extends Error {}

const hostnameSchema = z.object({
  id: z.string(),
  hostname: z.string(),
  status: z.string(),
  ssl: z.object({ status: z.string() }).loose(),
  ownership_verification: z.object({ name: z.string(), value: z.string() }).loose().optional(),
})
export type CustomHostname = z.infer<typeof hostnameSchema>

export interface CloudflareApi {
  /** Registers the host with Cloudflare for SaaS, or returns it when it is already registered. */
  ensureHostname: (hostname: string) => Promise<CustomHostname>
  /** Removes the host if it is registered; a host Cloudflare does not know is already gone. */
  removeHostname: (hostname: string) => Promise<void>
}

/** SAAS §8's states from Cloudflare's two: the hostname's own status and its certificate's. */
export const hostStatusOf = (h: Pick<CustomHostname, 'status' | 'ssl'>): HostStatus => {
  if (h.status === 'active' && h.ssl.status === 'active') return 'live'
  if (['blocked', 'moved', 'deleted'].includes(h.status) || h.ssl.status.startsWith('validation_timed_out') || h.ssl.status === 'deleted') return 'failed'
  if (h.status === 'active' || ['pending_issuance', 'pending_deployment', 'issuing'].includes(h.ssl.status)) return 'issuing'
  return 'verifying'
}

const envelope = <S extends z.ZodType>(result: S) => z.object({ success: z.boolean(), result })

export const cloudflareClient = ({ token, zoneId, fetchImpl = fetch }: { token: string; zoneId: string; fetchImpl?: typeof fetch }): CloudflareApi => {
  const call = async <S extends z.ZodType>(schema: S, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<z.infer<S>> => {
    let response: Response
    try {
      response = await fetchImpl(`${apiBase}/zones/${zoneId}/custom_hostnames${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new CloudflareUnavailable('no answer')
    }
    if (response.status >= 500 || response.status === 429) throw new CloudflareUnavailable(`answered ${response.status}`)
    if (!response.ok) throw new CloudflareRefused(`answered ${response.status}`)
    const parsed = schema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new CloudflareUnavailable('answered in a shape we do not read')
    return parsed.data
  }

  return {
    ensureHostname: async (hostname) => {
      const found = await call(envelope(z.array(hostnameSchema)), 'GET', `?hostname=${encodeURIComponent(hostname)}`)
      const existing = found.result[0]
      if (existing) return existing
      return (await call(envelope(hostnameSchema), 'POST', '', { hostname, ssl: { method: 'http', type: 'dv' } })).result
    },
    removeHostname: async (hostname) => {
      const found = await call(envelope(z.array(hostnameSchema)), 'GET', `?hostname=${encodeURIComponent(hostname)}`)
      const existing = found.result[0]
      if (existing) await call(z.unknown(), 'DELETE', `/${encodeURIComponent(existing.id)}`)
    },
  }
}
