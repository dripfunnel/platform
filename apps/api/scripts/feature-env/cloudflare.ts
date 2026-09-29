import { z } from 'zod'
import { ignoreNotFound, request } from './http'

const api = 'https://api.cloudflare.com/client/v4'

const envelope = z.object({
  result: z.unknown(),
  result_info: z.object({ total_pages: z.number() }).partial().optional(),
})

const withId = z.looseObject({ id: z.string() })
const named = withId.extend({ name: z.string() })

export type Cloudflare = ReturnType<typeof cloudflare>

export const cloudflare = (token: string, accountId: string, zoneId: string) => {
  const call = async <T extends z.ZodType>(path: string, result: T, init?: { method?: string; body?: unknown }): Promise<z.output<T>> =>
    result.parse(envelope.parse(await request(`${api}${path}`, token, init)).result)
  const account = `/accounts/${accountId}`
  const zone = `/zones/${zoneId}`

  const allPages = async <T extends z.ZodType>(path: string, item: T): Promise<z.output<T>[]> => {
    const items: z.output<T>[] = []
    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?'
      const body = envelope.parse(await request(`${api}${path}${separator}page=${page}&per_page=25`, token))
      const result = z.array(item).parse(body.result)
      items.push(...result)
      if (result.length === 0 || page >= (body.result_info?.total_pages ?? page)) return items
    }
  }

  return {
    ensurePagesProject: async (name: string) => {
      const found = await ignoreNotFound(() => call(`${account}/pages/projects/${name}`, named))
      if (!found) await call(`${account}/pages/projects`, named, { method: 'POST', body: { name, production_branch: 'main' } })
    },

    ensurePagesDomain: async (project: string, host: string) => {
      const found = await ignoreNotFound(() => call(`${account}/pages/projects/${project}/domains/${host}`, named))
      if (!found) await call(`${account}/pages/projects/${project}/domains`, named, { method: 'POST', body: { name: host } })
    },

    deletePagesDomain: (project: string, host: string) =>
      ignoreNotFound(() => call(`${account}/pages/projects/${project}/domains/${host}`, z.unknown(), { method: 'DELETE' })),

    deletePagesBranchDeployments: async (project: string, branch: string) => {
      const deployment = withId.extend({ deployment_trigger: z.object({ metadata: z.object({ branch: z.string() }).partial() }).partial() })
      const all = (await ignoreNotFound(() => allPages(`${account}/pages/projects/${project}/deployments?env=preview`, deployment))) ?? []
      for (const d of all.filter((d) => d.deployment_trigger?.metadata?.branch === branch)) {
        await ignoreNotFound(() => call(`${account}/pages/projects/${project}/deployments/${d.id}?force=true`, z.unknown(), { method: 'DELETE' }))
      }
    },

    upsertCname: async (host: string, target: string, comment: string) => {
      const [existing] = await call(`${zone}/dns_records?type=CNAME&name=${host}`, z.array(withId))
      const body = { type: 'CNAME', name: host, content: target, proxied: true, ttl: 1, comment }
      if (existing) await call(`${zone}/dns_records/${existing.id}`, withId, { method: 'PUT', body })
      else await call(`${zone}/dns_records`, withId, { method: 'POST', body })
    },

    deleteDnsRecords: async (host: string) => {
      for (const record of await call(`${zone}/dns_records?name=${host}`, z.array(withId))) {
        await ignoreNotFound(() => call(`${zone}/dns_records/${record.id}`, z.unknown(), { method: 'DELETE' }))
      }
    },

    ensureHyperdrive: async (name: string, connectionString: string) => {
      const url = new URL(connectionString)
      const origin = {
        scheme: 'postgres',
        host: url.hostname,
        port: Number(url.port || 5432),
        database: decodeURIComponent(url.pathname.slice(1)),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      }
      const existing = (await call(`${account}/hyperdrive/configs`, z.array(named))).find((c) => c.name === name)
      if (existing) return (await call(`${account}/hyperdrive/configs/${existing.id}`, withId, { method: 'PUT', body: { name, origin } })).id
      return (await call(`${account}/hyperdrive/configs`, withId, { method: 'POST', body: { name, origin } })).id
    },

    hyperdriveNames: async () => (await call(`${account}/hyperdrive/configs`, z.array(named))).map((c) => c.name),

    deleteHyperdrive: async (name: string) => {
      const existing = (await call(`${account}/hyperdrive/configs`, z.array(named))).find((c) => c.name === name)
      if (existing) await ignoreNotFound(() => call(`${account}/hyperdrive/configs/${existing.id}`, z.unknown(), { method: 'DELETE' }))
    },

    workerNames: async () => (await call(`${account}/workers/scripts`, z.array(withId))).map((w) => w.id),

    deleteWorker: async (name: string) => {
      const routes = await call(`${zone}/workers/routes`, z.array(withId.extend({ script: z.string().optional() })))
      for (const route of routes.filter((r) => r.script === name)) {
        await ignoreNotFound(() => call(`${zone}/workers/routes/${route.id}`, z.unknown(), { method: 'DELETE' }))
      }
      for (const domain of await call(`${account}/workers/domains?service=${name}`, z.array(withId))) {
        await ignoreNotFound(() => call(`${account}/workers/domains/${domain.id}`, z.unknown(), { method: 'DELETE' }))
      }
      await ignoreNotFound(() => call(`${account}/workers/scripts/${name}?force=true`, z.unknown(), { method: 'DELETE' }))
    },
  }
}
