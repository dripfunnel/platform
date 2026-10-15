import type { ScopedSql } from '#db/scoped/index'
import { storeSlugTaken } from '#db/scoped/signup'

// A store's slug names its free addresses {slug}.<SHOP_DOMAIN> and {slug}-preview.<SHOP_DOMAIN> (USERS-AND-DOMAINS §2, SAAS §4.1).
/** Names no store can take: the platform's own hosts, and any `-preview` name (it would be another store's preview host). */
export const reservedSlugs = new Set(['admin', 'api', 'app', 'help', 'hooks', 'mail', 'platform', 'portal', 'preview', 'shop', 'shops', 'status', 'store', 'support', 'www'])
export const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
export const isReservedSlug = (name: string): boolean => reservedSlugs.has(name) || name.endsWith('-preview')

/** `base`, or `base-2`, `base-3`… the first slug no store holds and none reserves. */
export const freeStoreSlug = async (tx: ScopedSql, base: string): Promise<string> => {
  const stem = base.slice(0, 36).replace(/-+$/, '') || 'store'
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? stem : `${stem}-${n}`
    if (slugPattern.test(candidate) && !isReservedSlug(candidate) && !(await storeSlugTaken(tx, candidate))) return candidate
  }
}
