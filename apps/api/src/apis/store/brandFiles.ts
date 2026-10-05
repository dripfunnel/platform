import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { selectPortalBrand } from '#db/scoped/portalBrand'
import { brandFiles, type BrandFile } from './shell'

// The partner's live logos and favicon on its own portal host (white label: no DripFunnel URL),
// streamed from R2. Only the published version's files are ever served.

const prefix = '/api/brand/'

export const brandFileOf = (pathname: string): BrandFile | null => {
  if (!pathname.startsWith(prefix)) return null
  const name = pathname.slice(prefix.length)
  return name in brandFiles ? (name as BrandFile) : null
}

export const serveBrandFile = async (sql: postgres.Sql, assets: R2Bucket | null, partnerId: string, file: BrandFile, now: Date): Promise<Response> => {
  if (!assets) return new Response(null, { status: 404 })
  const brand = await withSystemScope(sql, (tx) => selectPortalBrand(tx, partnerId, now))
  const key = brand?.[brandFiles[file]]
  const object = key ? await assets.get(key) : null
  if (!object) return new Response(null, { status: 404 })
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      // A new version publishes new keys, so a short cache is enough to pick it up.
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  })
}
