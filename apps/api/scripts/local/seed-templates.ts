import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import type { R2Bucket } from '@cloudflare/workers-types'
import { amzDate, authorization } from '#integrations/ses/sigv4'
import { isThemePath } from '#saas/storefronts/paths'

// Stands in for the release's template upload (storefront ARCHITECTURE §2.3) until it exists: writes the layout
// templates.ts reads into the sites bucket, so a store's first template choice can run. Local wrangler R2 by default;
// `--remote` writes STOREFRONT_SITES_BUCKET over R2's S3 API with the R2_STOREFRONT_* keys (#730).
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const templates = `${repo}templates/storefront/`
const coreFlag = process.argv.indexOf('--core')
const core = coreFlag >= 0 ? (process.argv[coreFlag + 1] ?? '') : (JSON.parse(readFileSync(`${repo}packages/storefront-core/package.json`, 'utf8')) as { version: string }).version
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(core)) throw new Error(`--core needs a version such as 1.2.3 or 1.2.3-dev.4, got "${core}"`)
const tracked = (dir: string) => execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean)
const read = (path: string) => ({ path, content: readFileSync(`${repo}${path}`, 'utf8') })

const skeleton = tracked('templates/storefront')
  .filter((p) => !p.startsWith('templates/storefront/themes/'))
  .map((p) => ({ ...read(p), path: p.slice('templates/storefront/'.length) }))
  .filter((f) => !isThemePath(f.path))

const remote = process.argv.includes('--remote')
const need = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`--remote needs ${name}`)
  return value
}
const target = remote
  ? { account: need('R2_STOREFRONT_ACCOUNT_ID'), keyId: need('R2_STOREFRONT_ACCESS_KEY_ID'), secret: need('R2_STOREFRONT_SECRET_ACCESS_KEY'), bucket: need('STOREFRONT_SITES_BUCKET') }
  : null
const proxy = target ? null : await getPlatformProxy<{ STOREFRONT_SITES: R2Bucket }>({ environment: 'local' })
const sha256Hex = (body: string) => createHash('sha256').update(body).digest('hex')
const putRemote = async (t: NonNullable<typeof target>, key: string, body: string, contentType: string) => {
  const host = `${t.account}.r2.cloudflarestorage.com`
  const path = `/${t.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
  const headers = { host, 'content-type': contentType, 'x-amz-content-sha256': sha256Hex(body), 'x-amz-date': amzDate(new Date()) }
  const signed = await authorization({ accessKeyId: t.keyId, secretAccessKey: t.secret, region: 'auto', service: 's3' }, { method: 'PUT', path, headers, body })
  const response = await fetch(`https://${host}${path}`, { method: 'PUT', headers: { ...headers, authorization: signed }, body })
  if (!response.ok) throw new Error(`PUT ${key} answered ${response.status}`)
}
const put = async (key: string, body: string, contentType = 'application/json') => {
  if (target) return putRemote(target, key, body, contentType)
  await proxy?.env.STOREFRONT_SITES.put(key, body, { httpMetadata: { contentType } })
}
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
await proxy?.dispose()
console.log(`Seeded templates ${keys.join(', ')} at core ${core} into ${target?.bucket ?? 'storefront-sites-local'}.`)
