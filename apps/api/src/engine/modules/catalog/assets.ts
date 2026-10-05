import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { checkMedia, type MediaCheck } from '#core/media'
import type { TenantContext } from '#core/tenancy'
import { insertAsset, selectAsset } from '#db/scoped/catalog'
import { withScope } from '#db/scoped/index'

// Catalogue files (DATA-MODEL §7.3 `asset`; FIRST-RELEASE §19 `uploadAsset`): checked by their bytes,
// stored under the store's own R2 prefix, owned by the uploader's scope until a product links them.

/** What the catalogue needs of the assets bucket (the Worker's `ASSETS` R2 binding). */
export interface AssetStore {
  put: (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>
  get: (key: string) => Promise<{ body: ReadableStream } | null>
}

export const assetsAudit = { uploaded: 'asset.uploaded' } as const

export type UploadResult =
  | { ok: true; asset: { id: string; kind: 'image' | 'video'; mime: string; bytes: number; width: number | null; height: number | null } }
  | Extract<MediaCheck, { ok: false }>

export interface AssetDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  store: AssetStore
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const createAssetService = ({ sql, context, actor, activity, facts, store }: AssetDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null

  const upload = async (bytes: Uint8Array<ArrayBuffer>): Promise<UploadResult> => {
    const checked = checkMedia(bytes)
    if (!checked.ok) return checked
    const { type } = checked
    const key = `stores/${storeId}/assets/${crypto.randomUUID()}.${type.ext}`
    const checksum = hex(await crypto.subtle.digest('SHA-256', bytes))
    // Written inside the row's transaction, as brand files are: a failed write rolls the row back; a commit
    // failing after it leaves an object no row names (the sweep for those is open on #293).
    const id = await withScope(sql, context, async (tx) => {
      const made = await insertAsset(tx, { storeId, sellerId, key, kind: type.kind, mime: type.mime, bytes: bytes.byteLength, width: type.width, height: type.height, checksum, createdBy: actor.id })
      await activity.record(tx, {
        category: 'write',
        action: assetsAudit.uploaded,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        sellerId,
        target: { type: 'file', id: made, label: type.mime },
        reason: null,
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      await store.put(key, bytes, { httpMetadata: { contentType: type.mime } })
      return made
    })
    return { ok: true, asset: { id, kind: type.kind, mime: type.mime, bytes: bytes.byteLength, width: type.width, height: type.height } }
  }

  /** A file the caller may read, as a response the portal can show; null for one it can't, which looks the same as none. */
  const open = async (id: string): Promise<{ body: ReadableStream; mime: string; bytes: number } | null> => {
    const row = await withScope(sql, context, (tx) => selectAsset(tx, storeId, id))
    if (!row) return null
    const object = await store.get(row.r2_key)
    return object ? { body: object.body, mime: row.mime, bytes: row.bytes } : null
  }

  return { upload, open }
}
