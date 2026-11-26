import type postgres from 'postgres'
import { z } from 'zod'
import { selectDemoSite } from '#db/scoped/demoStores'
import { withSystemScope } from '#db/scoped/index'
import { demoLabel } from '#db/scoped/shopCaller'

// The templates' demos on one open host, demo.<SHOP_DOMAIN>/?theme=<key or name> (storefront PREVIEW.md §9): no link, no session.

export const demoAddress = (shopDomain: string, template: string): string => `https://${demoLabel}.${shopDomain}/?theme=${encodeURIComponent(template)}`

/** `?theme=` as store-proxy sends it, lower-cased: a template's key or its name ("thread", "start from scratch"). */
const asked = z.string().regex(/^[\p{Ll}\p{Lo}\p{N}][\p{Ll}\p{Lo}\p{N} &'.-]{0,59}$/u)

/** `key` is the template's, for the cookie, whichever way it was named. */
export type DemoSite = { ok: true; key: string; storeId: string; folder: string } | { ok: false }

/** store-proxy's question for a demo request; a template with no ready demo, or no such template, has none. */
export const lookupDemoSite = async (sql: postgres.Sql, template: unknown): Promise<DemoSite> => {
  const name = asked.safeParse(template)
  if (!name.success) return { ok: false }
  const site = await withSystemScope(sql, (tx) => selectDemoSite(tx, name.data))
  return site ? { ok: true, key: site.key, storeId: site.store_id, folder: site.folder } : { ok: false }
}
