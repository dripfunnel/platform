import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { imageNames, mediaFolder } from '../../media'

// next dev only (pageExtensions in next.config.ts): a static export can't hold a route with no images to list.
const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export const GET = async (_request: Request, { params }: { params: Promise<{ name: string }> }) => {
  const { name } = await params
  if (!imageNames().includes(name)) return new Response(null, { status: 404 })
  return new Response(readFileSync(join(mediaFolder, name)), { headers: { 'content-type': types[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream' } })
}
