import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { markVerified, selectUpload } from '#db/scoped/builds'
import { assetsFolder, buildFolder, manifestName, stagingFolder } from './layout'
import type { SitesBucket } from './templates'
import { digestOf, manifestSchema } from './manifest'

// LIVE-SHOP.md §4 step 9 item 2: each staged object is read once, and the same bytes are hashed and written to the
// private build folder only when they match the manifest. Nothing in staging is read again; the JS and CSS then go to
// the public bucket from that folder, and the manifest last, so a build folder with one is whole.

/** Why an upload can't go live; the publish fails with this code (SAAS §9.1). */
export type UploadRefusal = 'not_uploaded' | 'manifest_refused' | 'file_missing' | 'file_mismatch'

export const uploadRefusals: ReadonlySet<string> = new Set<UploadRefusal>(['not_uploaded', 'manifest_refused', 'file_missing', 'file_mismatch'])

export class UploadRefused extends Error {
  override name = 'UploadRefused'
  constructor(readonly code: UploadRefusal) {
    super(code)
  }
}

export interface VerifyDeps {
  sql: postgres.Sql
  sites: SitesBucket
  assets: SitesBucket
  now: () => Date
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

const types: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
}

const contentTypeOf = (path: string) => types[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'

/** The hashed JS and CSS the asset host serves (LIVE-SHOP §2); everything stays in the private folder too. */
export const isPublicAsset = (path: string) => /\.(js|css)$/.test(path)

const copy = async (to: SitesBucket, key: string, bytes: ArrayBuffer, sha256: string, path: string) => {
  // R2 refuses bytes whose SHA-256 isn't the one given, a second check on the write itself.
  await to.put(key, bytes, { sha256, httpMetadata: { contentType: contentTypeOf(path) } })
}

/** Idempotent: a retry copies again from the frozen manifest, and a verified build answers at once. */
export const verifyUpload = async (deps: VerifyDeps, storeId: string, buildId: string): Promise<void> => {
  const row = await withSystemScope(deps.sql, (tx) => selectUpload(tx, storeId, buildId))
  if (row?.verified_at) return
  if (!row?.uploaded_at) throw new UploadRefused('not_uploaded')
  const parsed = manifestSchema.safeParse(row.upload_manifest)
  if (!parsed.success || (await digestOf(parsed.data.files)) !== row.gate_digest) throw new UploadRefused('manifest_refused')
  const staging = stagingFolder(storeId, buildId)
  const folder = buildFolder(storeId, buildId)
  for (const file of parsed.data.files) {
    const staged = await deps.sites.get(`${staging}${file.path}`)
    if (!staged) throw new UploadRefused('file_missing')
    const bytes = await staged.arrayBuffer()
    if (bytes.byteLength !== file.size || hex(await crypto.subtle.digest('SHA-256', bytes)) !== file.sha256) throw new UploadRefused('file_mismatch')
    await copy(deps.sites, `${folder}${file.path}`, bytes, file.sha256, file.path)
  }
  for (const file of parsed.data.files.filter((f) => isPublicAsset(f.path))) {
    const kept = await deps.sites.get(`${folder}${file.path}`)
    if (!kept) throw new UploadRefused('file_missing')
    await copy(deps.assets, `${assetsFolder(storeId, buildId)}${file.path}`, await kept.arrayBuffer(), file.sha256, file.path)
  }
  const manifest = new TextEncoder().encode(JSON.stringify(parsed.data))
  await deps.sites.put(`${folder}${manifestName}`, manifest.buffer, { sha256: hex(await crypto.subtle.digest('SHA-256', manifest)), httpMetadata: { contentType: 'application/json' } })
  await withSystemScope(deps.sql, (tx) => markVerified(tx, buildId, deps.now()))
}
