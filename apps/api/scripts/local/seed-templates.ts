import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { getPlatformProxy } from 'wrangler'
import type { R2Bucket } from '@cloudflare/workers-types'
import { selectNewestRelease, selectSandboxImage } from '#db/scoped/coreReleases'
import { withSystemScope } from '#db/scoped/index'
import { amzDate, authorization } from '#integrations/ses/sigv4'
import { isThemePath } from '#saas/storefronts/paths'
import { assertLocalHost } from '../migrate/host-guard'

// Writes the layout templates.ts reads into the sites bucket (storefront ARCHITECTURE §2.3), each theme's preview being
// the fast gate's bundle (PREVIEW §4). Local wrangler R2 by default; `--remote` writes STOREFRONT_SITES_BUCKET over R2's
// S3 API with the R2_STOREFRONT_* keys (#730). `--released` reads core_release in DATABASE_URL: alone it names the
// newest row, with `--core` it requires that version's row, so a version whose image isn't recorded is never pointed at.
const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const templates = `${repo}templates/storefront/`
const coreFlag = process.argv.indexOf('--core')
const releasedCore = async (wanted: string | undefined): Promise<string> => {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('--released needs DATABASE_URL')
  assertLocalHost(url)
  const sql = postgres(url, { max: 1 })
  try {
    const version = wanted ?? (await withSystemScope(sql, selectNewestRelease))
    if (!version) throw new Error('core_release has no version to upload templates for')
    if (!(await withSystemScope(sql, (tx) => selectSandboxImage(tx, version)))) throw new Error(`core_release has no unretired row for ${version}`)
    return version
  } finally {
    await sql.end()
  }
}
const named = coreFlag >= 0 ? (process.argv[coreFlag + 1] ?? '') : undefined
const core = process.argv.includes('--released')
  ? await releasedCore(named || undefined)
  : named !== undefined
    ? named
    : (JSON.parse(readFileSync(`${repo}packages/storefront-core/package.json`, 'utf8')) as { version: string }).version
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
  if (!response.ok) throw new Error(`PUT ${key} answered ${response.status}: ${(await response.text()).slice(0, 300)}`)
}
const put = async (key: string, body: string, contentType = 'application/json') => {
  if (target) return putRemote(target, key, body, contentType)
  await proxy?.env.STOREFRONT_SITES.put(key, body, { httpMetadata: { contentType } })
}
type Built = { ok: true; bundle: { files: { path: string }[] } } | { ok: false; problems: unknown[] }
// The sandbox builds its own bundle (apps/sandbox/scripts/bundle-theme.ts): the API takes no dependency on its source.
const bundle = (theme: string, out: string): Built =>
  JSON.parse(execFileSync('pnpm', ['--silent', '--filter', '@dripfunnel/sandbox', 'exec', 'tsx', 'scripts/bundle-theme.ts', theme, out], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) as Built
const contentTypes: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
const scratch = mkdtempSync(join(tmpdir(), 'seed-templates-'))
const keys = readdirSync(`${templates}themes`)
try {
  for (const key of keys) {
    const root = `templates/storefront/themes/${key}/`
    const files = tracked(root.slice(0, -1)).map((p) => ({ ...read(p), path: p.slice(root.length) })).filter((f) => isThemePath(f.path))
    const out = join(scratch, key)
    const built = await bundle(`${templates}themes/${key}`, out)
    if (!built.ok) throw new Error(`The ${key} theme's preview doesn't build: ${JSON.stringify(built.problems)}`)
    const prefix = `templates/${core}/themes/${key}/`
    await put(`${prefix}source.json`, JSON.stringify({ files }))
    const manifest = []
    for (const { path } of built.bundle.files) {
      const body = readFileSync(join(out, path), 'utf8')
      await put(`${prefix}preview/files/${path}`, body, contentTypes[extname(path)] ?? 'application/octet-stream')
      manifest.push({ path, sha256: sha256Hex(body) })
    }
    await put(`${prefix}preview/manifest.json`, JSON.stringify({ files: manifest }))
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
await put(`templates/${core}/skeleton.json`, JSON.stringify({ files: skeleton }))
await put('templates/current.json', JSON.stringify({ core }))
await proxy?.dispose()
console.log(`Seeded templates ${keys.join(', ')} at core ${core} into ${target?.bucket ?? 'storefront-sites-local'}.`)
