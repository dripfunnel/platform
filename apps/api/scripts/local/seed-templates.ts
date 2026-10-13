import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import type { R2Bucket } from '@cloudflare/workers-types'
import { isThemePath } from '#saas/storefronts/paths'

// Stands in for the release's template upload (storefront ARCHITECTURE §2.3) until it exists: writes the layout
// templates.ts reads into the local sites bucket, so a store's first template choice can run here.
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const templates = `${repo}templates/storefront/`
const core = (JSON.parse(readFileSync(`${repo}packages/storefront-core/package.json`, 'utf8')) as { version: string }).version
const tracked = (dir: string) => execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean)
const read = (path: string) => ({ path, content: readFileSync(`${repo}${path}`, 'utf8') })

const skeleton = tracked('templates/storefront')
  .filter((p) => !p.startsWith('templates/storefront/themes/'))
  .map((p) => ({ ...read(p), path: p.slice('templates/storefront/'.length) }))
  .filter((f) => !isThemePath(f.path))

const proxy = await getPlatformProxy<{ STOREFRONT_SITES: R2Bucket }>({ environment: 'local' })
const put = (key: string, body: string, contentType = 'application/json') => proxy.env.STOREFRONT_SITES.put(key, body, { httpMetadata: { contentType } })

const keys = readdirSync(`${templates}themes`)
for (const key of keys) {
  const root = `templates/storefront/themes/${key}/`
  const files = tracked(root.slice(0, -1)).map((p) => ({ ...read(p), path: p.slice(root.length) })).filter((f) => isThemePath(f.path))
  const html = `<!doctype html><title>${key}</title><p>${key} preview (local stand-in)</p>`
  const prefix = `templates/${core}/themes/${key}/`
  await put(`${prefix}source.json`, JSON.stringify({ files }))
  await put(`${prefix}preview/files/index.html`, html, 'text/html')
  await put(`${prefix}preview/manifest.json`, JSON.stringify({ files: [{ path: 'index.html', sha256: createHash('sha256').update(html).digest('hex') }] }))
}
await put(`templates/${core}/skeleton.json`, JSON.stringify({ files: skeleton }))
await put('templates/current.json', JSON.stringify({ core }))
await proxy.dispose()
console.log(`Seeded templates ${keys.join(', ')} at core ${core} into storefront-sites-local.`)
