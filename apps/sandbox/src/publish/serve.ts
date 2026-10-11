import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, normalize } from 'node:path'
import type { CatalogueSnapshot } from '@dripfunnel/storefront-core/guard'

// What the check step serves to its own headless browser, on 127.0.0.1 only: a built folder as the edge Worker would
// (LIVE-SHOP §5), and core's offline Shop API fixture in place of the real one (LIVE-SHOP §4 step 7).

const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', xml: 'application/xml', txt: 'text/plain; charset=utf-8' }

/** A path inside one of `roots`: `/cart/` is `cart/index.html`; nothing climbs out. */
export const fileFor = async (roots: readonly string[], path: string): Promise<{ rel: string; bytes: Buffer } | null> => {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  const rel = normalize(`${decoded}${decoded.endsWith('/') ? 'index.html' : ''}`.replace(/^\/+/, ''))
  if (rel.startsWith('..') || rel.includes('\0')) return null
  for (const root of roots) {
    const file = join(root, rel)
    if (existsSync(file)) return { rel, bytes: await readFile(file).catch(() => Buffer.alloc(0)) }
  }
  return null
}

export type Served = { origin: string; close: () => Promise<void> }

/** Serves `roots` (the first that has a file wins), each HTML page with the CSP the build's manifest will carry. */
export const serveFolders = async (roots: readonly string[], csp: (rel: string) => string | null): Promise<Served> => {
  const server = createServer((req, res) => {
    void (async () => {
      const found = await fileFor(roots, new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      if (!found) return res.writeHead(404).end()
      const type = types[found.rel.split('.').at(-1) ?? ''] ?? 'application/octet-stream'
      const policy = found.rel.endsWith('.html') ? csp(found.rel) : null
      res.writeHead(200, { 'content-type': type, ...(policy ? { 'content-security-policy': policy } : {}) }).end(found.bytes)
    })().catch(() => res.writeHead(500).end())
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((resolve) => server.close(() => resolve())) }
}

export type ShopReport = { kind: string; subject: string; detail: string | null }

/**
 * Core's offline Shop API: the store from the snapshot, and the problems the page's own sealed components report
 * (ARCHITECTURE §3.5); anything else answers as an outage would, which a page must survive.
 */
export const shopFixture = (snapshot: CatalogueSnapshot, reports: ShopReport[]) => (body: string): unknown => {
  let request: { query?: unknown; variables?: unknown }
  try {
    request = JSON.parse(body) as typeof request
  } catch {
    return { errors: [{ message: 'Not JSON.' }] }
  }
  const query = typeof request.query === 'string' ? request.query : ''
  const v = (typeof request.variables === 'object' && request.variables !== null ? request.variables : {}) as Record<string, unknown>
  if (query.includes('reportStorefrontProblem')) {
    reports.push({ kind: String(v['kind'] ?? ''), subject: String(v['subject'] ?? ''), detail: typeof v['detail'] === 'string' ? v['detail'] : null })
    return { data: { reportStorefrontProblem: true } }
  }
  if (/^\s*query Store\b/.test(query)) return { data: { store: snapshot.store } }
  return { errors: [{ message: 'The offline Shop API has no answer for this.', extensions: { code: 'UNAVAILABLE' } }] }
}
