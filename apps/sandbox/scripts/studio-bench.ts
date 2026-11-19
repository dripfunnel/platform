import { request } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser } from 'playwright-core'
import { z } from 'zod'
import { chromiumPath } from '../src/browser'

// The studio's quality bench (storefront AI-STUDIO §4 "The bench"): asks the local studio each case's request, then scores how close the store's
// preview is to the sample site. Local only, run by hand: each case spends a real AI request.

const usage = 'usage: pnpm --filter ./apps/sandbox studio:bench [cases.json] [--score-only]'
const casesSchema = z.strictObject({
  /** The local API Worker, e.g. http://localhost:8787. */
  api: z.string().url(),
  /** The merchant portal's host the Store API answers on, e.g. store.akshaylocal.localhost. */
  host: z.string().min(1),
  cases: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-z0-9-]{1,40}$/),
        text: z.string().min(1).max(10_000),
        sampleUrl: z.string().url().startsWith('https://'),
        model: z.string().nullable().default(null),
        device: z.enum(['desktop', 'tablet', 'phone']).default('desktop'),
        page: z.string().default('/'),
      }),
    )
    .min(1),
})
type Case = z.infer<typeof casesSchema>['cases'][number]

const widths = { desktop: 1440, tablet: 834, phone: 390 } as const
const maxHeight = 8000
const askTimeoutMs = 25 * 60_000

const local = (address: string) => {
  const { hostname } = new URL(address.includes('://') ? address : `http://${address}`)
  return hostname === 'localhost' || hostname.endsWith('.localhost')
}

type Api = { api: string; host: string; session: string; store: string }

/** One Store API call on the local Worker, with the session as a bearer (never logged) and the acting store's header. */
const call = <T>(to: Api, query: string, variables: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const { api, host, session, store } = to
    const body = JSON.stringify({ query, variables })
    const url = new URL('/api/', api)
    const req = request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', timeout: askTimeoutMs, headers: { host, authorization: `Bearer ${session}`, 'x-store': store, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const answer = z.object({ data: schema.nullable().optional(), errors: z.array(z.object({ message: z.string() })).optional() }).safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'))
        if (!answer.success) return reject(new Error(`the Store API answered HTTP ${res.statusCode ?? '?'}`))
        const { data } = answer.data
        return data ? resolve(data) : reject(new Error(answer.data.errors?.map((e) => e.message).join('; ') ?? 'the Store API answered no data'))
      })
    })
    req.on('timeout', () => req.destroy(new Error('the Store API timed out')))
    req.on('error', reject)
    req.end(body)
  })

/** The page top down at the device's width, scrolled first so sections that load on view are drawn. */
const shoot = async (browser: Browser, address: string, device: Case['device']): Promise<Buffer> => {
  const page = await browser.newPage({ viewport: { width: widths[device], height: 900 }, ignoreHTTPSErrors: local(address) })
  try {
    await page.goto(address, { waitUntil: 'networkidle', timeout: 45_000 })
    await page.evaluate(async (limit) => {
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, limit); y += 600) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 150))
      }
      window.scrollTo(0, 0)
    }, maxHeight)
    await page.waitForTimeout(800)
    const height = Math.min(maxHeight, await page.evaluate(() => document.documentElement.scrollHeight))
    return await page.screenshot({ clip: { x: 0, y: 0, width: widths[device], height }, fullPage: true })
  } finally {
    await page.close()
  }
}

/** Both shots scaled to one small width and compared over their common height, whole and in ten bands, as 0–100. */
// Plain source, not a function: tsx's name helpers don't exist in the page.
const scorer = `async (first, second) => {
  const load = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
  const [x, y] = await Promise.all([load(first), load(second)]);
  const width = 240;
  const height = Math.max(1, Math.round(Math.min(x.naturalHeight / x.naturalWidth, y.naturalHeight / y.naturalWidth) * width));
  const pixels = (img) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, img.naturalWidth, (height / width) * img.naturalWidth, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const p = pixels(x);
  const q = pixels(y);
  const rows = (from, to) => {
    let diff = 0;
    for (let i = from * width * 4; i < to * width * 4; i += 4) diff += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
    return Math.round(100 * (1 - diff / (Math.max(1, to - from) * width * 3 * 255)));
  };
  return { total: rows(0, height), bands: Array.from({ length: 10 }, (_, i) => rows(Math.floor((i * height) / 10), Math.floor(((i + 1) * height) / 10))) };
}`
const scoredSchema = z.object({ total: z.number(), bands: z.array(z.number()) })

const score = async (browser: Browser, a: Buffer, b: Buffer): Promise<{ total: number; bands: number[] }> => {
  const page = await browser.newPage()
  try {
    const url = (png: Buffer) => JSON.stringify(`data:image/png;base64,${png.toString('base64')}`)
    return scoredSchema.parse(await page.evaluate(`(${scorer})(${url(a)}, ${url(b)})`))
  } finally {
    await page.close()
  }
}

const ask = async (to: Api, c: Case): Promise<string> =>
  (
    await call(
      to,
      'mutation A($text: String!, $sample: String, $model: String, $page: String!, $device: String!) { askDesign(text: $text, sampleUrl: $sample, model: $model, page: $page, device: $device, mode: "change") { outcome } }',
      { text: c.text, sample: c.sampleUrl, model: c.model, page: c.page, device: c.device },
      z.object({ askDesign: z.object({ outcome: z.string() }) }),
    )
  ).askDesign.outcome

/** The draft's preview, by the same signed link the portal's Open preview gives. */
const previewOf = async (to: Api): Promise<string> => {
  const link = (await call(to, 'mutation { previewLink }', {}, z.object({ previewLink: z.string().url() }))).previewLink
  if (!local(link)) throw new Error('the preview link is not on the local stack')
  return link
}

const escape = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

const report = (rows: { c: Case; outcome: string; total: number | null; bands: number[] }[]) => `<!doctype html><meta charset="utf-8"><title>Studio bench</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}.pair{display:flex;gap:12px;margin:12px 0 32px}.pair img{width:48%;border:1px solid #ddd}</style>
<h1>Studio bench</h1><table><tr><th>Case</th><th>Model</th><th>Outcome</th><th>Score</th><th>Bands, top down</th></tr>
${rows.map((r) => `<tr><td>${escape(r.c.name)}</td><td>${escape(r.c.model ?? 'default')}</td><td>${escape(r.outcome)}</td><td>${r.total ?? '–'}</td><td>${r.bands.join(' · ')}</td></tr>`).join('\n')}</table>
${rows.map((r) => `<h2>${escape(r.c.name)}</h2><div class="pair"><figure><figcaption>Sample site</figcaption><img src="${r.c.name}-sample.png"></figure><figure><figcaption>Studio's preview</figcaption><img src="${r.c.name}-preview.png"></figure></div>`).join('\n')}`

const args = process.argv.slice(2)
const scoreOnly = args.includes('--score-only')
const file = args.find((a) => !a.startsWith('--')) ?? join(import.meta.dirname, 'studio-bench.cases.json')
const config = casesSchema.parse(JSON.parse(await readFile(file, 'utf8')))
if (![config.api, config.host].every(local)) throw new Error('the bench runs against the local stack only: api and host must be localhost')
const session = process.env['STUDIO_BENCH_SESSION'] ?? ''
const store = process.env['STUDIO_BENCH_STORE'] ?? ''
const to: Api = { api: config.api, host: config.host, session, store }
if (!session || !store) throw new Error(`set STUDIO_BENCH_SESSION (the portal's session cookie value) and STUDIO_BENCH_STORE (the store id)\n${usage}`)
const executablePath = chromiumPath()
if (!executablePath) throw new Error('no Chrome found: set CHROME_PATH')

const out = join(import.meta.dirname, '..', '.studio-bench', new Date().toISOString().replace(/[:.]/g, '-'))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ executablePath })
const rows: { c: Case; outcome: string; total: number | null; bands: number[] }[] = []
try {
  for (const c of config.cases) {
    const started = Date.now()
    let outcome = 'scored only'
    if (!scoreOnly) outcome = await ask(to, c).catch((error: unknown) => `error: ${error instanceof Error ? error.message : 'unknown'}`)
    const [sample, preview] = await Promise.all([shoot(browser, c.sampleUrl, c.device), previewOf(to).then((link) => shoot(browser, link, c.device))])
    await writeFile(join(out, `${c.name}-sample.png`), sample)
    await writeFile(join(out, `${c.name}-preview.png`), preview)
    const { total, bands } = await score(browser, sample, preview)
    rows.push({ c, outcome, total, bands })
    console.log(`${c.name}: ${outcome}, score ${total} (${Math.round((Date.now() - started) / 1000)} s)`)
  }
} finally {
  await browser.close()
}
await writeFile(join(out, 'results.json'), JSON.stringify(rows.map((r) => ({ name: r.c.name, model: r.c.model, outcome: r.outcome, score: r.total, bands: r.bands })), null, 2))
await writeFile(join(out, 'report.html'), report(rows))
console.log(`report: ${join(out, 'report.html')}`)
