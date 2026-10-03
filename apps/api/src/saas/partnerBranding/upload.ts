import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import { partnerRoleHas } from '#auth/partnerPermissions'
import { withScope } from '#db/scoped/index'
import { partnerEntry } from '#saas/activity/index'
import { checkBrandFile, type BrandFileCheck, type BrandFileKind } from './brandFile'

/** The one thing an upload needs of the assets bucket (the Worker's `ASSETS` R2 binding). */
export interface BrandFileStore {
  put: (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>
}

export interface BrandUploadDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  store: BrandFileStore
}

export type BrandUploadResult = { ok: true; key: string } | { ok: false; code: 'FORBIDDEN' } | Extract<BrandFileCheck, { ok: false }>

export const brandUploadAudit = 'branding.file_uploaded'

/** Stores a checked file under the caller's own prefix and answers its key, which publishBranding takes. */
export const uploadBrandFile = async ({ sql, caller, facts, activity, store }: BrandUploadDeps, kind: BrandFileKind, bytes: Uint8Array): Promise<BrandUploadResult> => {
  if (!partnerRoleHas(caller.user.role, 'branding.write')) return { ok: false, code: 'FORBIDDEN' }
  const checked = checkBrandFile(bytes)
  if (!checked.ok) return checked
  const key = `partners/${caller.partner.id}/brand/${crypto.randomUUID()}.${checked.type.ext}`
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId: caller.partner.id }
  // The file is written inside the entry's transaction: a failed write rolls the entry back, but a
  // commit failing after it leaves an unlogged object that no branding names (FIRST-RELEASE §8).
  await withScope(sql, context, async (tx) => {
    await activity.record(tx, partnerEntry(caller, facts)({ action: brandUploadAudit, target: { type: 'file', id: key, label: kind }, reason: null }))
    await store.put(key, bytes, { httpMetadata: { contentType: checked.type.contentType } })
  })
  return { ok: true, key }
}
