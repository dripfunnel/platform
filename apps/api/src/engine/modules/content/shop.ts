import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { pageWindow, pageWith, type Page, type PageRequest } from '#core/paging'
import { encodeCursor } from '#core/cursor'
import type { TenantContext } from '#core/tenancy'
import { selectStoreEntitlement } from '#db/scoped/entitlements'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { publishDuePosts, selectShopContent, selectShopContentList, selectShopProductSlugs, type ContentKind, type ShopContentRow } from '#db/scoped/storefrontContent'
import { slugPattern, type ContentBlock } from './rules'

// The Shop API's read of content pages and the blog (FIRST-RELEASE §19 Shop API): what is live, in the shopper's
// language, a product named only while the shopper may see it.

export const maxShopContentPage = 50

/** A block as a shopper reads it: a products block names the web addresses of the products still on show. */
export type ShopContentBlock = Exclude<ContentBlock, { kind: 'products' }> | { kind: 'products'; productSlugs: string[] }

export interface ShopContentView extends Omit<ShopContentRow, 'body'> {
  body: ShopContentBlock[]
}

export type ShopContentResult<T> = { ok: true; value: T } | { ok: false; reason: 'INVALID_CURSOR' }

export interface ShopContentDeps {
  sql: postgres.Sql
  context: TenantContext
  language: string
  now: () => Date
}

export const createShopContent = ({ sql, context, language, now }: ShopContentDeps) => {
  const { storeId } = context
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  // A blog the plan no longer has is paused, never deleted (SAAS §6.2): its posts come back with the plan.
  const blogOn = async () => (await withSystemScope(sql, (tx) => selectStoreEntitlement(tx, storeId, 'blog', now()))).enabled === true

  const viewed = async (tx: ScopedSql, rows: readonly ShopContentRow[]): Promise<ShopContentView[]> => {
    const blocks = rows.flatMap((r) => r.body as ContentBlock[])
    const slugs = await selectShopProductSlugs(tx, storeId, [...new Set(blocks.flatMap((b) => (b.kind === 'products' ? b.productIds : [])))])
    return rows.map((r) => ({
      ...r,
      body: (r.body as ContentBlock[]).map((b) => (b.kind === 'products' ? { kind: 'products', productSlugs: b.productIds.flatMap((id) => slugs.get(id) ?? []) } : b)),
    }))
  }

  const list = async (kind: ContentKind, request: PageRequest, filter: { inMenu: boolean | null; tag: string | null }): Promise<ShopContentResult<Page<ShopContentView>>> => {
    const window = pageWindow(request, maxShopContentPage)
    if (!window.ok) return { ok: false, reason: window.code }
    if (kind === 'post' && !(await blogOn())) return { ok: true, value: pageWith([], window.window, () => '') }
    const rows = await inScope(async (tx) => viewed(tx, await selectShopContentList(tx, storeId, kind, language, window.window, filter)))
    return { ok: true, value: pageWith(rows, window.window, (r) => encodeCursor({ occurredAt: (kind === 'post' ? r.publish_at : null) ?? r.updated_at, id: r.id })) }
  }

  const one = async (kind: ContentKind, slug: string): Promise<ShopContentView | null> => {
    const clean = slug.trim().toLowerCase()
    if (!slugPattern.test(clean) || clean.length > 100) return null
    if (kind === 'post' && !(await blogOn())) return null
    return inScope(async (tx) => {
      const row = await selectShopContent(tx, storeId, kind, clean, language)
      return row ? ((await viewed(tx, [row]))[0] ?? null) : null
    })
  }

  return {
    pages: (request: PageRequest, inMenu: boolean | null) => list('page', request, { inMenu, tag: null }),
    page: (slug: string) => one('page', slug),
    posts: (request: PageRequest, tag: string | null) => list('post', request, { inMenu: null, tag }),
    post: (slug: string) => one('post', slug),
  }
}

export const contentPublishedAction = 'blog_post.published'
const dueBatch = 200

/** The job that publishes each scheduled post whose time has come (FIRST-RELEASE §14), as the system; the count it published. */
export const publishScheduledPosts = async (sql: postgres.Sql, activity: ActivityLog, now: Date): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    const due = await publishDuePosts(tx, now, dueBatch)
    await activity.recordAll(
      tx,
      due.map((p) => ({
        category: 'system',
        action: contentPublishedAction,
        result: 'success',
        actorKind: 'job',
        actorId: 'storefront.scheduled_posts',
        actorLabel: 'Scheduled post',
        partnerId: p.partner_id,
        storeId: p.store_id,
        target: { type: 'blog_post', id: p.id, label: p.title },
        reason: null,
        api: 'system',
        requestId: null,
        ip: null,
        userAgent: null,
        visibility: 'store',
      })),
    )
    return due.length
  })
