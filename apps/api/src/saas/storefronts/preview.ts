import type postgres from 'postgres'
import { z } from 'zod'
import { previewLinkSeconds, type PreviewLinks } from '#auth/previewLink'
import { merchantRolePermissions, merchantRoles } from '#auth/storePermissions'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { holdsMerchantRole, selectPreviewKey, selectPreviewStore } from '#db/scoped/previewAccess'

// The preview link and the access re-check behind it (storefront PREVIEW.md §5): the API's side of the edge Worker's
// `__open` and of every HTML and /shop-api request on a preview host. Nothing here is cached (PREVIEW §4 step 4).

export type PreviewAccess = { ok: true; storeId: string; userId: string; epoch: number; folder: string | null } | { ok: false }

const refused: PreviewAccess = { ok: false }
/** ACCESS §5.1: opening a preview is part of `publish`, so its issuer must still hold it. */
const previewRoles = merchantRoles.filter((role) => merchantRolePermissions[role].includes('publish'))

const previewKey = z.string().regex(/^[a-z2-7]{10}$/)
export const previewCheck = z.strictObject({ key: previewKey, storeId: z.uuid(), userId: z.uuid(), epoch: z.int().nonnegative() })
export type PreviewCheck = z.infer<typeof previewCheck>

/** The key must still be the store's, its revocation number unmoved, and the issuer still able to publish (§5 step 4). */
const recheck = async (tx: ScopedSql, c: PreviewCheck): Promise<PreviewAccess> => {
  const store = await selectPreviewStore(tx, c.key)
  if (!store || store.store_id !== c.storeId || store.preview_epoch !== c.epoch) return refused
  if (!(await holdsMerchantRole(tx, c.userId, c.storeId, previewRoles))) return refused
  return { ok: true, storeId: c.storeId, userId: c.userId, epoch: c.epoch, folder: store.folder }
}

/** `__open?t=`: a link for another store's preview, an expired one or a forged one gets the same refusal (§5 step 2). */
export const openPreview = async (sql: postgres.Sql, links: PreviewLinks, key: unknown, token: unknown, now: Date): Promise<PreviewAccess> => {
  const host = previewKey.safeParse(key)
  if (!host.success || typeof token !== 'string') return refused
  const grant = await links.open(token)
  if (!grant || grant.expiresAt <= now.getTime() / 1000) return refused
  return withSystemScope(sql, (tx) => recheck(tx, { key: host.data, storeId: grant.storeId, userId: grant.userId, epoch: grant.epoch }))
}

export const checkPreview = async (sql: postgres.Sql, input: unknown): Promise<PreviewAccess> => {
  const parsed = previewCheck.safeParse(input)
  if (!parsed.success) return refused
  return withSystemScope(sql, (tx) => recheck(tx, parsed.data))
}

/** "Open preview" (§5 step 1): the store's own link, naming the user who asked; the Store API has checked both. */
export const previewLinkFor = async (sql: postgres.Sql, links: PreviewLinks, domain: string, storeId: string, userId: string, now: Date): Promise<string | null> => {
  const store = await withSystemScope(sql, (tx) => selectPreviewKey(tx, storeId))
  if (!store) return null
  const token = await links.seal({ storeId, userId, epoch: store.preview_epoch, expiresAt: Math.floor(now.getTime() / 1000) + previewLinkSeconds })
  return `https://${store.preview_key}.${domain}/__open?t=${token}`
}
