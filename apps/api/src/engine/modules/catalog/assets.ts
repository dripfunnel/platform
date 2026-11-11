import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { checkDownload, checkMedia, checkProductVideo, maxProductVideoBytes, type MediaCheck } from '#core/media'
import type { TenantContext } from '#core/tenancy'
import { deleteAsset, hasLibraryChecksum, insertAsset, renameAsset, selectAsset, selectLibrary, selectLibraryUse, type LibraryAsset } from '#db/scoped/catalog'
import { selectFeatures } from '#db/scoped/catalogListing'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'

// Catalogue files (DATA-MODEL §7.3 `asset`; FIRST-RELEASE §19 `uploadAsset`): checked by their bytes,
// stored under the store's own R2 prefix, owned by the uploader's scope until a product links them.

/** What the catalogue needs of the assets bucket (the Worker's `ASSETS` R2 binding). */
export interface AssetStore {
  put: (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>
  get: (key: string) => Promise<{ body: ReadableStream } | null>
  /** The Worker's bucket has it; a test's stand-in may not. */
  delete?: (keys: string[]) => Promise<unknown>
}

export const assetsAudit = { uploaded: 'asset.uploaded', renamed: 'asset.renamed', deleted: 'asset.deleted' } as const

export type UploadResult =
  | { ok: true; asset: { id: string; kind: 'image' | 'video' | 'file'; mime: string; bytes: number; width: number | null; height: number | null } }
  | Extract<MediaCheck, { ok: false }>

export interface AssetDeps {
  sql: postgres.Sql
  context: TenantContext
  /** A merchant's or supplier's person on the Store API, or a rider's own photo on the Delivery API (DELIVERY §4). */
  actor: { id: string; partnerId: string; kind?: 'person' | 'rider' }
  activity: ActivityLog
  facts: RequestFacts
  store: AssetStore
  /** The text of the store's theme at its repo's `main`; null when it can't be read, which keeps every design's file. */
  siteText?: () => Promise<string | null>
}

class NotAdmitted extends Error {}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const createAssetService = (deps: AssetDeps) => {
  const { sql, context, actor, activity, facts, store } = deps
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null

  const save = async (
    bytes: Uint8Array<ArrayBuffer>,
    file: { kind: 'image' | 'video' | 'file'; ext: string; mime: string; width: number | null; height: number | null },
    admit?: (tx: ScopedSql) => Promise<boolean>,
  ): Promise<string> => {
    const key = `stores/${storeId}/assets/${crypto.randomUUID()}.${file.ext}`
    const checksum = hex(await crypto.subtle.digest('SHA-256', bytes))
    // Written inside the row's transaction, as brand files are: a failed write rolls the row back; a commit
    // failing after it leaves an object no row names (the sweep for those is open on #293).
    return withScope(sql, context, async (tx) => {
      if (admit && !(await admit(tx))) throw new NotAdmitted()
      const made = await insertAsset(tx, { storeId, sellerId, key, kind: file.kind, mime: file.mime, bytes: bytes.byteLength, width: file.width, height: file.height, checksum, createdBy: actor.id })
      await activity.record(tx, {
        category: 'write',
        action: assetsAudit.uploaded,
        result: 'success',
        actorKind: actor.kind ?? 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        sellerId,
        target: { type: 'file', id: made, label: file.mime },
        reason: null,
        api: actor.kind === 'rider' ? 'delivery' : 'store',
        visibility: 'store',
        ...facts,
      })
      await store.put(key, bytes, { httpMetadata: { contentType: file.mime } })
      return made
    })
  }

  const upload = async (bytes: Uint8Array<ArrayBuffer>): Promise<UploadResult> => {
    const checked = checkMedia(bytes)
    if (!checked.ok) return checked
    const { type } = checked
    const id = await save(bytes, type)
    return { ok: true, asset: { id, kind: type.kind, mime: type.mime, bytes: bytes.byteLength, width: type.width, height: type.height } }
  }

  /**
   * A photo alone, no video: a rider's profile picture (DELIVERY §4 `updateProfile`). `admit` runs first in the
   * upload's own transaction, so a limit it counts can't be raced; false answers RATE_LIMITED.
   */
  const uploadImage = async (bytes: Uint8Array<ArrayBuffer>, admit?: (tx: ScopedSql) => Promise<boolean>): Promise<UploadResult | { ok: false; code: 'RATE_LIMITED' }> => {
    const checked = checkMedia(bytes)
    if (!checked.ok) return checked
    const { type } = checked
    if (type.kind !== 'image') return { ok: false, code: 'UNSUPPORTED_TYPE' }
    const id = await save(bytes, type, admit).catch((error: unknown) => {
      if (error instanceof NotAdmitted) return null
      throw error
    })
    if (id === null) return { ok: false, code: 'RATE_LIMITED' }
    return { ok: true, asset: { id, kind: type.kind, mime: type.mime, bytes: bytes.byteLength, width: type.width, height: type.height } }
  }

  /** A product's video (#1401): an MP4 or WebM of at most 4 MB and 30 seconds; the library's own videos keep the wider limit of `upload`. */
  const uploadProductVideo = async (bytes: Uint8Array<ArrayBuffer>): Promise<UploadResult | { ok: false; code: 'TOO_LONG' }> => {
    const checked = checkProductVideo(bytes)
    if (!checked.ok) return checked
    const { type } = checked
    const id = await save(bytes, type)
    return { ok: true, asset: { id, kind: 'video', mime: type.mime, bytes: bytes.byteLength, width: null, height: null } }
  }

  /** Settings › Catalogue's Video switch for this store. */
  const videoSwitchOn = (): Promise<boolean> => withScope(sql, context, async (tx) => (await selectFeatures(tx, storeId)).video)

  /** False for a stored video over the product video's 4 MB or 30 s, however it was uploaded (#1401); size from the row, length from the bytes. */
  const isProductVideo = async (id: string): Promise<boolean> => {
    const row = await withScope(sql, context, (tx) => selectAsset(tx, storeId, id))
    if (!row || !row.mime.startsWith('video/')) return true // a missing or non-video file is the catalogue's FILE_REFUSED
    if (row.bytes > maxProductVideoBytes) return false
    const object = await store.get(row.r2_key)
    if (!object) return false
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer())
    return checkProductVideo(bytes).ok
  }

  /** A download's file (CATALOG T14): kept as `file`, which no photo, page or storefront shows (migration 0064's asset policy). */
  const uploadDownload = async (bytes: Uint8Array<ArrayBuffer>): Promise<UploadResult> => {
    const checked = checkDownload(bytes)
    if (!checked.ok) return checked
    const id = await save(bytes, { kind: 'file', ext: checked.type.ext, mime: checked.type.mime, width: null, height: null })
    return { ok: true, asset: { id, kind: 'file', mime: checked.type.mime, bytes: bytes.byteLength, width: null, height: null } }
  }

  /** A file the caller may read, as a response the portal can show; null for one it can't, which looks the same as none. */
  const open = async (id: string): Promise<{ body: ReadableStream; mime: string; bytes: number } | null> => {
    const row = await withScope(sql, context, (tx) => selectAsset(tx, storeId, id))
    if (!row) return null
    const object = await store.get(row.r2_key)
    return object ? { body: object.body, mime: row.mime, bytes: row.bytes } : null
  }

  const entry = (action: string, target: string) => ({
    category: 'write' as const,
    action,
    result: 'success' as const,
    actorKind: 'person' as const,
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId: null,
    target: { type: 'file', id: target, label: 'file' },
    reason: null,
    api: 'store' as const,
    visibility: 'store' as const,
    ...facts,
  })

  /** Storefront › Assets: the merchant's own images and videos, newest first, with how often each is used. */
  const library = (o: { limit: number; before: { at: Date; id: string } | null; kind: 'image' | 'video' | null; search: string | null }): Promise<LibraryAsset[]> =>
    withScope(sql, context, (tx) => selectLibrary(tx, storeId, o))

  /** An empty name clears it. False for a file that isn't in the library. */
  const rename = async (id: string, name: string | null): Promise<boolean> =>
    withScope(sql, context, async (tx) => {
      if (!(await renameAsset(tx, storeId, id, name))) return false
      await activity.record(tx, entry(assetsAudit.renamed, id))
      return true
    })

  /** Only a file nothing uses goes; a file a design attached counts as used while the draft exists or the theme at `main` names its id. The object follows the row (a leftover object is the sweep's, #293). */
  const remove = async (id: string): Promise<'deleted' | 'in_use' | 'missing'> => {
    const found = await withScope(sql, context, (tx) => selectLibraryUse(tx, storeId, id))
    if (!found) return 'missing'
    if (found.uses > 0) return 'in_use'
    if (found.storefront_visible && found.in_draft) return 'in_use'
    if (found.storefront_visible) {
      const text = (await deps.siteText?.()) ?? null
      if (text === null || text.includes(id)) return 'in_use'
    }
    const result = await withScope(sql, context, async (tx) => {
      const again = await selectLibraryUse(tx, storeId, id)
      if (!again) return 'missing' as const
      if (again.uses > 0 || (again.storefront_visible && again.in_draft)) return 'in_use' as const
      await deleteAsset(tx, storeId, id)
      await activity.record(tx, entry(assetsAudit.deleted, id))
      return again.r2_key
    })
    if (result === 'missing' || result === 'in_use') return result
    await deps.store.delete?.([result]).catch(() => undefined)
    return 'deleted'
  }

  return { upload, uploadImage, uploadProductVideo, videoSwitchOn, isProductVideo, uploadDownload, open, library, rename, remove }
}

export interface RepoImageCopy {
  storeId: string
  partnerId: string
  /** The image's file name without its extension, which names the copy. */
  name: string
  bytes: Uint8Array<ArrayBuffer>
  commit: string
}

/**
 * A pushed theme image becomes a Storefront › Assets image of the merchant's, created by the system (#1415; AI-STUDIO §8),
 * unless the store already has its bytes there. Not an image (the guard passed it, so never expected): `refused`.
 */
export const copyRepoImage = async (deps: { sql: postgres.Sql; activity: ActivityLog; store: AssetStore }, image: RepoImageCopy): Promise<'copied' | 'present' | 'refused'> => {
  const checked = checkMedia(image.bytes)
  if (!checked.ok || checked.type.kind !== 'image') return 'refused'
  const { type } = checked
  const checksum = hex(await crypto.subtle.digest('SHA-256', image.bytes))
  return withSystemScope(deps.sql, async (tx) => {
    if (await hasLibraryChecksum(tx, image.storeId, checksum)) return 'present'
    const key = `stores/${image.storeId}/assets/${crypto.randomUUID()}.${type.ext}`
    const made = await insertAsset(tx, { storeId: image.storeId, sellerId: null, key, kind: 'image', mime: type.mime, bytes: image.bytes.byteLength, width: type.width, height: type.height, checksum, createdBy: null, name: image.name })
    await deps.activity.record(tx, {
      category: 'system',
      action: assetsAudit.uploaded,
      result: 'success',
      actorKind: 'job',
      actorId: 'publish-storefront',
      actorLabel: 'Publishing',
      partnerId: image.partnerId,
      storeId: image.storeId,
      target: { type: 'file', id: made, label: type.mime },
      changes: [{ field: 'commit', before: null, after: image.commit }],
      reason: 'repo_push',
      api: 'system',
      requestId: null,
      ip: null,
      userAgent: null,
      visibility: 'store',
    })
    await deps.store.put(key, image.bytes, { httpMetadata: { contentType: type.mime } })
    return 'copied'
  })
}
