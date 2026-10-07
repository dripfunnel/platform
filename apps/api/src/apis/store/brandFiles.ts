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

export const serveBrandFile = async (sql: postgres.Sql, assets: R2Bucket | null, images: ImagesBinding | null, partnerId: string, file: BrandFile, now: Date): Promise<Response> => {
  if (!assets) return new Response(null, { status: 404 })
  const brand = await withSystemScope(sql, (tx) => selectPortalBrand(tx, partnerId, now))
  const key = brand?.[brandFiles[file]]
  if (!key) return new Response(null, { status: 404 })
  const object = await assets.get(key)
  if (!object) return new Response(null, { status: 404 })
  let contentType = object.httpMetadata?.contentType ?? 'application/octet-stream'
  let body: ReadableStream | null = object.body
  // Raster logos go out as WebP, capped at 512 px wide; SVG is already small and a favicon keeps its size.
  if (images && file !== 'favicon' && contentType !== 'image/svg+xml') {
    try {
      const out = await images.input(object.body).transform({ width: 512 }).output({ format: 'image/webp' })
      contentType = out.contentType()
      body = out.image()
    } catch {
      // A corrupt file or a spent transformation quota still serves the original.
      body = (await assets.get(key))?.body ?? null
    }
  }
  return new Response(body, {
    headers: {
      'content-type': contentType,
      // A new version publishes new keys, so a short cache is enough to pick it up.
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
}
