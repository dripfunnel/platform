import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AiDeclined, GatewayError, SignInExpired, type AiAnswer, type AiProvider } from '#integrations/ai/index'
import type { Screenshotter } from '#integrations/cloudflare/screenshot'
import type { StockImages } from '#integrations/stockImages/pixabay'
import type { DnsLookup } from '#integrations/dns/doh'
import type { AssetStore } from '#engine/modules/catalog/index'
import { hashSessionId } from '#auth/session'
import { activityLog } from '#saas/activity/index'
import { exchangeSupportHandoff } from '#saas/storeSupport/index'
import { draftBundle, previewFolder, sourceBundle } from '#saas/storefronts/index'
import { StudioRunner, type DraftsBucket } from '#saas/studio/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { sandboxProcess, type SandboxProcess } from './support/sandboxProcess'
import { fakeSites, putText, type FakeSites } from './support/sites'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'
import { localStudio } from './support/studio'

// Card #318 (SAPI 17), part 2: the AI studio on the Store API (FIRST-RELEASE §14; storefront AI-STUDIO §3–§5; SAAS §9.2):
// a fake model, the real sandbox (apps/sandbox in its own process) and the real database; R2 is in memory.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

const core = '0.4.0'
const baselineDir = fileURLToPath(new URL('../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))
// Ticks a second each time it is read, so the chat's messages keep their order.
let clock = Date.parse('2026-10-12T09:00:00.000Z')
const now = () => new Date((clock += 1000))

const walk = async (dir: string, prefix = ''): Promise<{ path: string; content: string }[]> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix))).map(async (name) => {
        const rel = prefix ? `${prefix}/${name}` : name
        return (await stat(join(dir, rel))).isDirectory() ? walk(dir, rel) : [{ path: rel, content: await readFile(join(dir, rel), 'utf8') }]
      }),
    )
  ).flat()

const objects = new Map<string, ArrayBuffer>()
const drafts: DraftsBucket = {
  get: async (key) => {
    const bytes = objects.get(key)
    return bytes ? { arrayBuffer: async () => bytes } : null
  },
  put: async (key, value) => void objects.set(key, value),
  delete: async (key) => objects.delete(key),
}

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let sites: FakeSites
let host: SandboxProcess
let template: { path: string; content: string }[]
const runners = new Map<string, StudioRunner>()
const runnerOf = (storeId: string): StudioRunner => {
  const found = runners.get(storeId)
  if (found) return found
  const runner = new StudioRunner({
    db: (work) => work(db.sql),
    storeId,
    host: async () => host,
    drafts,
    sites,
    capacity: { acquire: async () => ({ granted: true }), release: async () => undefined },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    onBundle: () => undefined,
  })
  runners.set(storeId, runner)
  return runner
}
const local = localStudio(() => db.sql, runnerOf)

/** The model as a script: each call takes the next answer and records what it was sent. */
const script: { answers: string[]; sent: string[]; turns: { id: string; name: string; arguments: string }[][] } = { answers: [], sent: [], turns: [] }
const reply = (files: { path: string; content: string | null }[], words = 'I made the lead warmer.') => JSON.stringify({ files, reply: words, changed: ['Hero lead'], page: 'home' })
const provider: AiProvider = {
  complete: async (call): Promise<AiAnswer> => {
    script.sent.push(call.text)
    if (hold) {
      held?.()
      await hold
    }
    if (providerFails) throw providerFails
    const text = script.answers.shift() ?? reply([])
    return { text, model: 'fake-model', tokensIn: 1000, tokensOut: 200, costAmount: 1, costCurrency: 'USD' }
  },
  converse: async (call) => {
    script.sent.push('converse')
    const next = script.turns.shift()
    if (next) return { text: '', toolCalls: next, wantsTools: true, model: 'fake-model', tokensIn: 1, tokensOut: 1, costAmount: 0, costCurrency: 'USD' }
    void call
    if (hold) {
      held?.()
      await hold
    }
    const text = script.answers.shift() ?? reply([])
    return { text, toolCalls: [], wantsTools: false, model: 'fake-model', tokensIn: 1000, tokensOut: 200, costAmount: 1, costCurrency: 'USD' }
  },
}
let aiMode: 'plan' | 'none' = 'plan'
/** When set, the next model call throws it (a provider failure). */
let providerFails: Error | null = null
/** The studio's RPC fails before it reaches the model (a Durable Object fault). */
let studioDown = false
let askedModel: string | null = null
/** When set, the next model call waits on it, so a test can stop a change mid-thought. */
let hold: Promise<void> | null = null
let held: (() => void) | null = null
/** The world's design deps; a test sets the screenshotter, which sits behind the SSRF check (docs/ARCHITECTURE.md §7). */
const design: {
  ai: (billedTo: 'plan' | 'own_key', context: unknown, model: string | null) => AiProvider | null
  models: () => readonly string[]
  screenshots: Screenshotter | null
  readAsset: ((key: string) => Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null>) | null
  stock: StockImages | null
} = {
  ai: (billedTo, _context, model) => ((askedModel = model), aiMode === 'plan' && billedTo === 'plan' ? provider : null),
  models: () => ['claude-opus-5-5', 'claude-haiku-5-5'],
  screenshots: null,
  readAsset: null,
  stock: null,
}
let siteText: string | null = null
let stockBudget = 1000
const stored: string[] = []
const bucket: AssetStore = { put: async (key) => void stored.push(key), get: async () => null }
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const importImage = (who: Who, url: string) => w.gql(who, 'mutation I($u: String!) { importDesignImage(url: $u) }', { u: url })
const dns: Record<string, string[]> = { 'shop.example.com A': ['93.184.216.34'], 'inside.example.com A': ['10.1.2.3'] }
const lookup: DnsLookup = { resolve: async (name, type) => dns[`${name} ${type}`] ?? [] }

const enPages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''
const lead = (words: string) => ({ path: 'content/en/pages.json', content: enPages().replace(/"lead": "[^"]*"/, `"lead": "${words}"`) })
const refusedPage = { path: 'src/theme/pages/HomePage.tsx', content: "export const HomePage = () => { fetch('/x'); return null }\n" }

const ask = (who: Who, text: string, extra: Record<string, unknown> = {}) =>
  w.gql(who, 'mutation A($text: String!, $image: ID, $site: String, $model: String) { askDesign(text: $text, imageAssetId: $image, sampleUrl: $site, model: $model, page: "home", device: "desktop") { outcome message { id role text changed page canUndo } } }', { text, ...extra })
const draft = async (storeId: string) => (await db.sql<{ head_commit: string; preview_deploy_ref: string; commits: string[] }[]>`select head_commit, preview_deploy_ref, commits from design_draft where store_id = ${storeId}`)[0] ?? null
const usage = async (storeId: string) => (await db.sql<{ used: number }[]>`select used from store_usage where store_id = ${storeId} and key = 'ai_prompts'`)[0]?.used ?? 0
const texts = async (who: Who, locale = 'en-IN') => (await w.gql(who, 'query T($l: String!) { designText(page: "home", locale: $l) { key text } }', { l: locale })).data?.['designText'] as { key: string; text: string }[] | undefined

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, {
    now,
    secrets: null,
    lookup,
    studio: (context) => {
      const studio = local.studio(context)
      return { ...studio, change: (storeId, input, model) => (studioDown ? Promise.reject(new Error('the studio is unreachable')) : studio.change(storeId, input, model)) }
    },
    extra: { preview: { domain: 'my-store.one', links: { seal: async () => 'x', open: async () => null } }, design, files: bucket, allowStock: async () => stockBudget-- > 0, siteRepos: async () => (siteText === null ? null : ({ themeText: async () => siteText }) as never) },
  })
  host = await sandboxProcess()
  sites = fakeSites()
  template = await walk(baselineDir)
  await putText(sites, `templates/${core}/skeleton.json`, JSON.stringify({ files: [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }] }))
  await putText(sites, `templates/${core}/themes/baseline/source.json`, JSON.stringify({ files: template }))
  for (const storeId of [t.storeA1, t.storeB1]) {
    await db.sql`update store set core_version = ${core}, main_language = 'en-IN' where id = ${storeId}`
    await db.sql`insert into store_language (store_id, language) values (${storeId}, 'en-IN'), (${storeId}, 'hi-IN') on conflict do nothing`
    await db.sql`update storefront set repo_state = 'ready', template = 'baseline', repo = ${`sf-${storeId.slice(0, 8)}aa`}, repo_head = ${'a'.repeat(40)} where store_id = ${storeId}`
  }
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_mode', 1 from store where plan_id is not null`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_prompts', 6 from store where plan_id is not null`
}, 180_000)

afterAll(async () => {
  await host?.close()
  await db?.drop()
})

describe('asking for a change', () => {
  it('commits a passing change to the private draft with its preview, records the run, and pushes nothing', async () => {
    script.answers = [reply([lead('Warm linen, cut slowly.')])]
    const pushes = (await db.sql<{ n: number }[]>`select count(*)::int as n from storefront_push`)[0]?.n
    const asked = await ask('owner', 'Make the lead warmer')
    expect(asked).toMatchObject({ code: undefined, data: { askDesign: { outcome: 'changed', message: { role: 'ai', text: 'I made the lead warmer.', changed: ['Hero lead'], page: 'home', canUndo: true } } } })
    const row = await draft(t.storeA1)
    expect(objects.has(draftBundle(t.storeA1))).toBe(true)
    expect(sites.keys(previewFolder(t.storeA1, row?.preview_deploy_ref ?? '')).length).toBeGreaterThan(0)
    expect((await db.sql<{ n: number }[]>`select count(*)::int as n from storefront_push`)[0]?.n).toBe(pushes)
    expect(await usage(t.storeA1)).toBe(1)
    // The model saw the request, the page and the store; the activity entry never holds the words.
    expect(script.sent[0]).toContain('Make the lead warmer')
    expect(script.sent[0]).toContain('home page on desktop')
    const [logged] = await db.sql<{ changes: unknown; reason: string | null }[]>`select changes, reason from activity_log where store_id = ${t.storeA1} and action = 'storefront.design_requested'`
    expect(JSON.stringify(logged)).not.toContain('warmer')
    expect(logged?.changes).toEqual([expect.objectContaining({ field: 'outcome', after: 'changed' })])
    expect(await db.sql`select kind, billed_to, outcome from ai_run where store_id = ${t.storeA1}`).toEqual([{ kind: 'design', billed_to: 'plan', outcome: 'changed' }])
  })

  it('repairs a failing change from the exact errors; the repairs are the platform’s and don’t count on the meter', async () => {
    script.answers = [reply([refusedPage]), reply([lead('Repaired lead.')])]
    expect((await ask('owner', 'A change needing one repair')).data?.['askDesign']).toMatchObject({ outcome: 'changed' })
    expect(script.sent.at(-1)).toContain('failed these checks')
    const runs = await db.sql<{ kind: string; billed_to: string }[]>`select kind, billed_to from ai_run where store_id = ${t.storeA1} order by created_at desc limit 2`
    expect(runs.map((r) => `${r.kind}:${r.billed_to}`).sort()).toEqual(['design:plan', 'repair:platform'])
    expect(await usage(t.storeA1)).toBe(2)
  })

  it('refuses a change still failing after three repairs and leaves the draft as it was', async () => {
    const before = await draft(t.storeA1)
    script.answers = [reply([refusedPage]), reply([refusedPage]), reply([refusedPage]), reply([refusedPage])]
    expect((await ask('owner', 'Fetch something')).data?.['askDesign']).toMatchObject({ outcome: 'refused', message: { role: 'error', text: 'change_refused' } })
    expect(await draft(t.storeA1)).toEqual(before)
  })

  it('changes nothing for a price, stock or checkout request: the reply points to Products', async () => {
    const before = await draft(t.storeA1)
    script.answers = [reply([], 'Prices are changed in Products, not in your design.')]
    expect((await ask('owner', 'Make every price 10% lower')).data?.['askDesign']).toMatchObject({ outcome: 'unchanged', message: { role: 'ai', text: 'Prices are changed in Products, not in your design.', canUndo: false } })
    expect(await draft(t.storeA1)).toEqual(before)
  })

  it('runs two requests for one store one after the other', async () => {
    script.answers = [reply([lead('First of two.')]), reply([lead('Second of two.')])]
    const [one, two] = await Promise.all([ask('owner', 'First'), ask('owner', 'Second')])
    expect([one.data?.['askDesign'], two.data?.['askDesign']]).toEqual([expect.objectContaining({ outcome: 'changed' }), expect.objectContaining({ outcome: 'changed' })])
    expect((await texts('owner'))?.find((e) => e.key === 'pages:home.lead')?.text).toBe('Second of two.')
  })

  it('stops new requests once the month’s AI requests are used, and without a key on the store’s mode', async () => {
    await db.sql`update store_usage set used = 6 where store_id = ${t.storeA1} and key = 'ai_prompts'`
    const sent = script.sent.length
    expect((await ask('owner', 'One more')).code).toBe('AI_BUDGET_REACHED')
    await db.sql`update store_usage set used = 0 where store_id = ${t.storeA1} and key = 'ai_prompts'`
    aiMode = 'none'
    expect((await ask('owner', 'One more')).code).toBe('AI_NOT_CONNECTED')
    aiMode = 'plan'
    expect(script.sent.length).toBe(sent)
  })

  it('lets only one of two requests at once take the month’s last AI request, and refuses over-long input before the model', async () => {
    await db.sql`update store_usage set used = 5 where store_id = ${t.storeA1} and key = 'ai_prompts'`
    script.answers = [reply([lead('Last one in.')]), reply([lead('Too late.')])]
    const sent = script.sent.length
    const both = await Promise.all([ask('owner', 'Last request A'), ask('owner', 'Last request B')])
    expect(both.map((r) => r.code ?? 'ok').sort()).toEqual(['AI_BUDGET_REACHED', 'ok'])
    expect(script.sent.length).toBe(sent + 1)
    expect(await usage(t.storeA1)).toBe(6)
    await db.sql`update store_usage set used = 0 where store_id = ${t.storeA1} and key = 'ai_prompts'`
    expect((await ask('owner', 'x', { site: `https://example.com/${'a'.repeat(2048)}` })).code).toBe('INVALID_URL')
    expect((await w.gql('owner', 'query T($p: String!) { designText(page: $p, locale: "en-IN") { key } }', { p: 'p'.repeat(201) })).code).toBe('INVALID_INPUT')
    expect(script.sent.length).toBe(sent + 1)
  })

  it('gives the unit back when the studio fails before the model is asked', async () => {
    const used = await usage(t.storeA1)
    const sent = script.sent.length
    studioDown = true
    try {
      const lost = await ask('owner', 'Lost on the way')
      expect(lost.data?.['askDesign']).toMatchObject({ outcome: 'failed', message: { role: 'error' } })
    } finally {
        studioDown = false
    }
    expect(script.sent.length).toBe(sent)
    expect(await usage(t.storeA1)).toBe(used)
  })

  it('words a provider failure by reason, changes nothing, logs the code and still counts the request', async () => {
    const cases: [Error, string][] = [
      [new GatewayError('RATE_LIMITED', 30), 'change_failed:RATE_LIMITED'],
      [new GatewayError('PROVIDER_UNAVAILABLE'), 'change_failed:PROVIDER_UNAVAILABLE'],
      [new GatewayError('TIMEOUT'), 'change_failed:TIMEOUT'],
      [new GatewayError('INVALID_CREDENTIALS'), 'change_failed:CREDENTIALS_REJECTED'],
      [new SignInExpired(), 'change_failed:SIGN_IN_EXPIRED'],
      [new AiDeclined('the model declined'), 'change_failed:DECLINED'],
    ]
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((line: unknown) => void lines.push(String(line)))
    try {
      for (const [error, text] of cases) {
        const before = await draft(t.storeA1)
        const used = await usage(t.storeA1)
        providerFails = error
        try {
          expect((await ask('owner', 'Fails upstream')).data?.['askDesign']).toMatchObject({ outcome: 'failed', message: { role: 'error', text } })
        } finally {
          providerFails = null
        }
        expect(await draft(t.storeA1)).toEqual(before)
        expect(await usage(t.storeA1)).toBe(used + 1)
        await db.sql`update store_usage set used = ${used} where store_id = ${t.storeA1} and key = 'ai_prompts'`
      }
    } finally {
      log.mockRestore()
    }
    const failed = lines.filter((l) => l.includes('storefront_design_failed')).map((l) => (JSON.parse(l) as { code: string }).code)
    expect(failed).toEqual(['GatewayError:RATE_LIMITED', 'GatewayError:PROVIDER_UNAVAILABLE', 'GatewayError:TIMEOUT', 'GatewayError:INVALID_CREDENTIALS', 'SignInExpired:INVALID_CREDENTIALS', 'AiDeclined'])
  })

  it('takes only the store’s own merchant image: another store’s, a supplier’s or a non-id is refused before the model or a unit', async () => {
    const asset = async (storeId: string, sellerId: string | null = null) =>
      (await db.sql<{ id: string }[]>`insert into asset (store_id, seller_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${sellerId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
    const own = await asset(t.storeA1)
    const riderPhoto = await asset(t.storeA1)
    await db.sql`insert into rider (store_id, name, phone, photo_asset_id) values (${t.storeA1}, 'Rae', '+919800000301', ${riderPhoto})`
    const others = [await asset(t.storeB1), await asset(t.storeA1, t.sellerA1First), 'https://evil.example/x.png', crypto.randomUUID(), riderPhoto]
    const read: string[] = []
    design.readAsset = async (key) => (read.push(key), { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' })
    try {
      const sent = script.sent.length
      const used = await usage(t.storeA1)
      for (const image of others) expect((await ask('owner', 'Like this', { image })).code, image).toBe('INVALID_IMAGE')
      expect(read).toEqual([])
      expect(script.sent.length).toBe(sent)
      expect(await usage(t.storeA1)).toBe(used)
      // The model changes nothing here, so the draft the later tests build on stays as it was.
      script.answers = [reply([])]
      expect((await ask('owner', 'Like this', { image: own })).code).toBeUndefined()
      expect((await db.sql<{ v: boolean }[]>`select storefront_visible as v from asset where id = ${own}`)[0]?.v).toBe(false)
      expect((await db.sql<{ v: boolean }[]>`select storefront_visible as v from asset where id = ${others[0] ?? ''}`)[0]?.v).toBe(false)
      expect(read).toHaveLength(1)
      expect(script.sent.length).toBe(sent + 1)
    } finally {
      design.readAsset = null
    }
  })

  it('lets the AI add only a photo its own search returned', async () => {
    const downloaded: string[] = []
    design.stock = {
      search: async () => ({ total: 1, photos: [{ id: '42', thumb: 'https://cdn.pixabay.com/t.jpg', user: 'Ana', pageUrl: 'https://pixabay.com/p/42', tags: 'linen' }] }),
      download: async (id) => (downloaded.push(id), 'https://pixabay.com/get/42.png'),
    }
    dns['pixabay.com A'] = ['93.184.216.34']
    vi.stubGlobal('fetch', async () => new Response(png, { headers: { 'content-type': 'image/png' } }))
    const used = await usage(t.storeA1)
    await db.sql`update store_usage set used = 0 where store_id = ${t.storeA1} and key = 'ai_prompts'`
    const before = stored.length
    const call = (id: string, name: string, args: object) => ({ id, name, arguments: JSON.stringify(args) })
    script.turns = [[call('1', 'add_stock_image', { id: '999' })], [call('2', 'search_stock_images', { query: 'linen' })], [call('3', 'add_stock_image', { id: '42' })]]
    script.answers = [reply([])]
    try {
      expect((await ask('owner', 'A linen hero photo')).code).toBeUndefined()
      expect(downloaded).toEqual(['42'])
      expect(stored.length).toBe(before + 1)
    } finally {
      script.turns = []
      vi.unstubAllGlobals()
      design.stock = null
      await db.sql`update store_usage set used = ${used} where store_id = ${t.storeA1} and key = 'ai_prompts'`
    }
  })

  it('answers in chat mode with words only: no change, no draft move, one prompt taken, the reply in the chat', async () => {
    const before = await draft(t.storeA1)
    const used = await usage(t.storeA1)
    const sent = script.sent.length
    script.answers = ['Warmer colours would suit linen. Switch to Change mode to apply them.']
    const said = await w.gql('owner', 'mutation A($text: String!) { askDesign(text: $text, page: "home", device: "desktop", mode: "chat") { outcome message { role text changed canUndo } } }', { text: 'What would suit linen?' })
    expect(said.code).toBeUndefined()
    expect(said.data?.['askDesign']).toEqual({ outcome: 'unchanged', message: { role: 'ai', text: 'Warmer colours would suit linen. Switch to Change mode to apply them.', changed: [], canUndo: false } })
    expect(script.sent.length).toBe(sent + 1)
    expect(await draft(t.storeA1)).toEqual(before)
    expect(await usage(t.storeA1)).toBe(used + 1)
    expect((await ask('manager', 'Hi', { })).code).toBeDefined()
  })

  it('gives the chat prompt back when the sign-in failed before the model was asked, and keeps it when the provider failed', async () => {
    const used = await usage(t.storeA1)
    try {
      providerFails = new SignInExpired()
      expect((await w.gql('owner', 'mutation A { askDesign(text: "Hi", page: "home", device: "desktop", mode: "chat") { outcome } }')).data?.['askDesign']).toEqual({ outcome: 'failed' })
      expect(await usage(t.storeA1)).toBe(used)
      providerFails = new GatewayError('TIMEOUT')
      await w.gql('owner', 'mutation A { askDesign(text: "Hi", page: "home", device: "desktop", mode: "chat") { outcome } }')
      expect(await usage(t.storeA1)).toBe(used + 1)
    } finally {
      providerFails = null
    }
  })

  it('stops a change while the model is thinking: nothing changes, the chat says so, the unit stays spent', async () => {
    const before = await draft(t.storeA1)
    const used = await usage(t.storeA1)
    let release: () => void = () => undefined
    hold = new Promise<void>((resolve) => (release = resolve))
    const reached = new Promise<void>((resolve) => (held = resolve))
    script.answers = [reply([lead('Never lands.')])]
    try {
      const asking = ask('owner', 'Slow one')
      await reached
      const stopped = await w.gql('owner', 'mutation { cancelDesign }')
      expect(stopped.data?.['cancelDesign']).toBe(true)
      const done = await asking
      expect(done.data?.['askDesign']).toMatchObject({ outcome: 'cancelled', message: { role: 'note', text: 'stopped' } })
    } finally {
      release()
      hold = null
      held = null
    }
    expect(await draft(t.storeA1)).toEqual(before)
    expect(await usage(t.storeA1)).toBe(used + 1)
    expect((await w.gql('owner', 'mutation { cancelDesign }')).data?.['cancelDesign']).toBe(false)
    expect((await w.gql('manager', 'mutation { cancelDesign }')).code).toBeDefined()
  })

  it('searches stock images and downloads a chosen one into the store’s files, never hotlinking; hidden without a key', async () => {
    const stockQuery = 'query { stockImagesAvailable }'
    expect((await w.gql('owner', stockQuery)).data?.['stockImagesAvailable']).toBe(false)
    expect((await w.gql('owner', 'query { searchStockImages(query: "linen", page: 1) { id } }')).code).toBe('NOT_CONNECTED')
    design.stock = {
      search: async (query) => (query === 'down' ? null : { total: 1, photos: [{ id: '42', thumb: 'https://cdn.pixabay.com/t.jpg', user: 'Ana', pageUrl: 'https://pixabay.com/p/42', tags: 'linen' }] }),
      download: async (id) => (id === '42' ? 'https://pixabay.com/get/42.png' : null),
    }
    dns['pixabay.com A'] = ['93.184.216.34']
    vi.stubGlobal('fetch', async () => new Response(png, { headers: { 'content-type': 'image/png' } }))
    try {
      expect((await w.gql('owner', stockQuery)).data?.['stockImagesAvailable']).toBe(true)
      const found = await w.gql('owner', 'query { searchStockImages(query: "linen", page: 1) { id thumb user pageUrl } }')
      expect(found.data?.['searchStockImages']).toEqual([{ id: '42', thumb: 'https://cdn.pixabay.com/t.jpg', user: 'Ana', pageUrl: 'https://pixabay.com/p/42' }])
      expect((await w.gql('owner', 'query { searchStockImages(query: "down", page: 1) { id } }')).code).toBe('SAMPLE_UNAVAILABLE')
      expect((await w.gql('owner', 'query { searchStockImages(query: "", page: 1) { id } }')).code).toBe('INVALID_INPUT')
      expect((await w.gql('manager', 'query { searchStockImages(query: "linen", page: 1) { id } }')).code).toBeDefined()
      const used = async (id: string) => w.gql('owner', 'mutation U($i: String!) { useStockImage(id: $i) }', { i: id })
      expect((await used('../etc')).code).toBe('INVALID_INPUT')
      expect((await used('7')).code).toBe('SAMPLE_UNAVAILABLE')
      const before = stored.length
      const asset = (await used('42')).data?.['useStockImage'] as string
      expect(asset).toMatch(/^[0-9a-f-]{36}$/)
      expect(stored.length).toBe(before + 1)
      const [row] = await db.sql<{ store_id: string }[]>`select store_id from asset where id = ${asset}`
      expect(row?.store_id).toBe(t.storeA1)
    } finally {
      vi.unstubAllGlobals()
      design.stock = null
    }
  })

  it('refuses a partner’s read-only support session and a Manager every photo, library and Stop write, leaving the files as they were', async () => {
    const [agent] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'studio-support@partner-a.example', 'Sia', 'partner-support', 'active') returning id`
    const [seat] = await db.sql<{ id: string }[]>`select id from membership where user_id = ${w.people.owner}`
    const at = new Date()
    await db.sql`
      insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, started_at, expires_at, handoff_hash, handoff_expires_at, access)
      values (${t.partnerA}, ${t.storeA1}, ${seat?.id ?? ''}, ${agent?.id ?? ''}, 'Help', ${at}, ${new Date(at.getTime() + 30 * 60_000)}, ${await hashSessionId('tok-studio')}, ${new Date(at.getTime() + 5 * 60_000)}, 'read')`
    const entered = await exchangeSupportHandoff({ sql: db.sql, partnerId: t.partnerA, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => at }, 'tok-studio')
    const cookie = entered?.cookie ?? ''
    expect(cookie).not.toBe('')
    const [made] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${t.storeA1}, ${`stores/${t.storeA1}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`
    const id = made?.id ?? ''
    const assets = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from asset`)[0]?.n
    const putsBefore = stored.length
    const rows = await assets()
    const sources = [
      `mutation { renameLibraryAsset(id: "${id}", name: "x") }`,
      `mutation { deleteLibraryAsset(id: "${id}") }`,
      'mutation { useStockImage(id: "42") }',
      'mutation { importDesignImage(url: "https://example.com/a.png") }',
      'mutation { cancelDesign }',
      'query { searchStockImages(query: "linen", page: 1) { id } }',
      'query { libraryAssets { assets { id } } }',
    ]
    for (const source of sources) {
      expect([source, (await w.support(cookie, t.partnerA, source)).code]).toEqual([source, "BLOCKED_FOR_SUPPORT"])
      if (!source.startsWith('query { library')) expect([source, (await w.gql('manager', source)).code]).toEqual([source, 'FORBIDDEN'])
    }
    expect((await db.sql`select 1 from asset where id = ${id} and name is null`).length).toBe(1)
    expect(await assets()).toBe(rows)
    expect(stored.length).toBe(putsBefore)
    expect((await w.gql('bOwner', `mutation { renameLibraryAsset(id: "${id}", name: "x") }`)).code).toBe('NOT_FOUND')
    expect((await w.gql('bOwner', `mutation { deleteLibraryAsset(id: "${id}") }`)).code).toBe('NOT_FOUND')
    expect((await db.sql`select 1 from asset where id = ${id} and name is null`).length).toBe(1)
  })

  it('refuses the Nth+1 stock search, download and URL import with STOCK_BUSY, and the AI’s photo tools return nothing', async () => {
    design.stock = { search: async () => ({ total: 0, photos: [] }), download: async () => null }
    dns['pixabay.com A'] = ['93.184.216.34']
    try {
      stockBudget = 1
      expect((await w.gql('owner', 'query { searchStockImages(query: "linen", page: 1) { id } }')).code).toBeUndefined()
      for (const source of ['query { searchStockImages(query: "linen", page: 1) { id } }', 'mutation { useStockImage(id: "42") }', 'mutation { importDesignImage(url: "https://example.com/a.png") }']) {
        expect([source, (await w.gql('owner', source)).code]).toEqual([source, 'STOCK_BUSY'])
      }
    } finally {
      stockBudget = 1000
      design.stock = null
    }
  })

  it('lists the merchant’s own images and videos only, renames, searches, refuses to delete a used file, deletes an unused one', async () => {
    const row = async (storeId: string, kind: string, sellerId: string | null = null) =>
      (await db.sql<{ id: string }[]>`insert into asset (store_id, seller_id, r2_key, kind, mime, bytes, checksum) values (${storeId}, ${sellerId}, ${`stores/${storeId}/assets/${crypto.randomUUID()}.png`}, ${kind}, 'image/png', 10, ${'0'.repeat(64)}) returning id`)[0]?.id ?? ''
    const own = await row(t.storeA1, 'image')
    const video = await row(t.storeA1, 'video')
    const hidden = [await row(t.storeA1, 'file'), await row(t.storeA1, 'image', t.sellerA1First), await row(t.storeB1, 'image')]
    const list = async (who: Who, args = '') => (await w.gql(who, `query { libraryAssets${args} { assets { id kind name uses } next } }`)).data?.['libraryAssets'] as { assets: { id: string; kind: string; name: string | null; uses: number }[]; next: string | null } | undefined
    const ids = (await list('owner'))?.assets.map((a) => a.id) ?? []
    expect(ids).toEqual(expect.arrayContaining([own, video]))
    for (const h of hidden) expect(ids).not.toContain(h)
    expect((await list('owner', '(kind: "video")'))?.assets.map((a) => a.id)).toEqual([video])
    expect((await w.gql('owner', 'mutation R($i: ID!, $n: String!) { renameLibraryAsset(id: $i, name: $n) }', { i: own, n: ' Hero photo ' })).data?.['renameLibraryAsset']).toBe(true)
    expect((await list('owner', '(search: "hero")'))?.assets).toEqual([{ id: own, kind: 'image', name: 'Hero photo', uses: 0 }])
    expect((await w.gql('owner', 'mutation R($i: ID!, $n: String!) { renameLibraryAsset(id: $i, name: $n) }', { i: hidden[2], n: 'x' })).code).toBe('NOT_FOUND')
    expect((await w.gql('manager', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: own })).code).toBe('FORBIDDEN')
    expect((await w.gql('manager', 'mutation R($i: ID!) { renameLibraryAsset(id: $i, name: "x") }', { i: own })).code).toBe('FORBIDDEN')
    expect((await db.sql`select 1 from asset where id = ${own} and name = 'Hero photo'`).length).toBe(1)
    await db.sql`update store set logo_asset_id = ${own} where id = ${t.storeA1}`
    expect((await list('owner', '(search: "hero")'))?.assets[0]?.uses).toBe(1)
    expect((await w.gql('owner', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: own })).code).toBe('ASSET_IN_USE')
    await db.sql`update store set logo_asset_id = null where id = ${t.storeA1}`
    await db.sql`update asset set storefront_visible = true where id = ${own}`
    expect((await w.gql('owner', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: own })).code).toBe('ASSET_IN_USE')
    siteText = `url(${own})`
    expect((await w.gql('owner', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: own })).code).toBe('ASSET_IN_USE')
    siteText = 'no pictures here'
    expect((await w.gql('owner', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: own })).code, 'a studio draft exists').toBe('ASSET_IN_USE')
    const [kept] = await db.sql<Record<string, unknown>[]>`delete from design_draft where store_id = ${t.storeA1} returning *`
    expect((await list('owner', '(search: "%")'))?.assets).toEqual([])
    for (const h of hidden) expect((await w.gql('owner', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: h })).code, h).toBe('NOT_FOUND')
    expect((await w.gql('owner', 'mutation D($i: ID!) { deleteLibraryAsset(id: $i) }', { i: own })).data?.['deleteLibraryAsset']).toBe(true)
    expect((await db.sql`select 1 from asset where id = ${own}`).length).toBe(0)
    if (kept) await db.sql`insert into design_draft ${db.sql(kept)}`
    const theirs = ((await w.gql('bOwner', 'query { libraryAssets { assets { id } } }')).data?.['libraryAssets'] as { assets: { id: string }[] }).assets.map((x) => x.id)
    expect(theirs).toContain(hidden[2])
    expect(theirs).not.toContain(video)
  })

  it('imports an image from a public https address into the store’s own files, and refuses private, non-image and other addresses', async () => {
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string | URL) => {
      fetched.push(String(url))
      return String(url).endsWith('.png') ? new Response(png, { headers: { 'content-type': 'image/png' } }) : new Response('<html>', { status: 200 })
    })
    try {
      for (const url of ['http://shop.example.com/a.png', 'https://10.0.0.1/a.png', 'https://inside.example.com/a.png', 'https://localhost/a.png']) expect((await importImage('owner', url)).code, url).toBe('INVALID_URL')
      expect(fetched).toEqual([])
      expect((await importImage('owner', 'https://shop.example.com/page.html')).code).toBe('INVALID_IMAGE')
      const kept = stored.length
      const done = await importImage('owner', 'https://shop.example.com/a.png')
      const id = done.data?.['importDesignImage'] as string
      expect(id).toMatch(/^[0-9a-f-]{36}$/)
      expect(stored).toHaveLength(kept + 1)
      const [row] = await db.sql<{ store_id: string; kind: string }[]>`select store_id, kind from asset where id = ${id}`
      expect(row).toEqual({ store_id: t.storeA1, kind: 'image' })
      const [logged] = await db.sql<{ n: string }[]>`select count(*)::text as n from activity_log where store_id = ${t.storeA1} and action = 'storefront.image_imported'`
      expect(Number(logged?.n)).toBeGreaterThanOrEqual(1)
      expect((await importImage('manager', 'https://shop.example.com/a.png')).code).toBeDefined()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('screenshots a sample site only at a public https address, refused before the budget and the model', async () => {
    const taken: string[] = []
    design.screenshots = { take: async (url) => (taken.push(url.href), new Uint8Array([0xff, 0xd8, 0xff, 0xd9])) }
    try {
      const sent = script.sent.length
      const used = await usage(t.storeA1)
      for (const site of ['http://10.0.0.1/', 'https://10.0.0.1/', 'http://shop.example.com/', 'https://localhost/', 'https://inside.example.com/', 'https://shop.example.com:8443/', 'https://nowhere.example.com/'])
        expect((await ask('owner', 'Like this', { site })).code, site).toBe('INVALID_URL')
      expect(taken).toEqual([])
      expect(script.sent.length).toBe(sent)
      expect(await usage(t.storeA1)).toBe(used)
      // A store at its allowance is refused before the screenshot, so it costs the platform nothing.
      await db.sql`update store_usage set used = 6 where store_id = ${t.storeA1} and key = 'ai_prompts'`
      expect((await ask('owner', 'Like this', { site: 'https://shop.example.com/' })).code).toBe('AI_BUDGET_REACHED')
      expect(taken).toEqual([])
      await db.sql`update store_usage set used = ${used} where store_id = ${t.storeA1} and key = 'ai_prompts'`
      // The model changes nothing here, so the draft the later tests build on stays as it was.
      script.answers = [reply([])]
      expect((await ask('owner', 'Like this', { site: 'https://shop.example.com/' })).code).toBeUndefined()
      expect(taken).toEqual(['https://shop.example.com/'])
      expect(script.sent.length).toBe(sent + 1)
    } finally {
      design.screenshots = null
    }
  })

  it('is the Owner’s: the Manager reads the chat and is refused writes; Staff and suppliers are refused; another store’s chat stays its own', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) expect((await ask(who, 'Mine')).code).toBe('FORBIDDEN')
    const chat = await w.gql('manager', '{ designChat { messages { role text } next } }')
    expect((chat.data?.['designChat'] as { messages: { role: string }[] }).messages.length).toBeGreaterThan(0)
    expect((await w.gql('staff', '{ designChat { next } }')).code).toBe('FORBIDDEN')
    expect((await w.gql('bOwner', '{ designChat { messages { id } } }')).data?.['designChat']).toEqual({ messages: [] })
    expect((await ask('owner', 'x', { image: crypto.randomUUID() })).code).toBe('INVALID_IMAGE')
    expect((await ask('owner', 'x', { site: 'http://10.0.0.1/' })).code).toBe('NOT_CONNECTED')

  })
})

describe('editing, undoing and discarding', () => {
  it('Edit text changes one key in one offered language through the gate, never logging the words', async () => {
    expect((await texts('owner', 'hi-IN'))?.some((e) => e.key === 'pages:home.lead')).toBe(true)
    const saved = await w.gql('owner', 'mutation E { saveDesignText(locale: "hi-IN", key: "pages:home.lead", text: "हाथ से बुना हुआ") }')
    expect(saved).toMatchObject({ code: undefined, data: { saveDesignText: true } })
    expect((await texts('owner', 'hi-IN'))?.find((e) => e.key === 'pages:home.lead')?.text).toBe('हाथ से बुना हुआ')
    expect((await w.gql('owner', 'mutation E { saveDesignText(locale: "hi-IN", key: "pages:home.nothing", text: "x") }')).code).toBe('NOT_FOUND')
    expect((await w.gql('owner', 'mutation E { saveDesignText(locale: "fr-FR", key: "pages:home.lead", text: "x") }')).code).toBe('INVALID_LANGUAGE')
    expect((await w.gql('manager', 'mutation E { saveDesignText(locale: "hi-IN", key: "pages:home.lead", text: "x") }')).code).toBe('FORBIDDEN')
    const [logged] = await db.sql<{ changes: unknown }[]>`select changes from activity_log where store_id = ${t.storeA1} and action = 'storefront.text_edited'`
    expect(JSON.stringify(logged)).not.toContain('हाथ')
    expect(logged?.changes).toEqual([expect.objectContaining({ after: 'hi pages:home.lead' })])
  })

  it('undoes the latest change only, as a new change with a new preview', async () => {
    script.answers = [reply([lead('To be undone.')])]
    const latest = (await ask('owner', 'Change to undo')).data?.['askDesign'] as { message: { id: string } }
    const [older] = await db.sql<{ id: string }[]>`select id from design_message where store_id = ${t.storeA1} and role = 'ai' and commit is not null and id <> ${latest.message.id} order by created_at limit 1`
    expect((await w.gql('owner', 'mutation U($id: ID!) { undoDesignChange(messageId: $id) { id } }', { id: older?.id })).code).toBe('NOT_LATEST')
    const before = await draft(t.storeA1)
    const undone = await w.gql('owner', 'mutation U($id: ID!) { undoDesignChange(messageId: $id) { undone canUndo } }', { id: latest.message.id })
    expect(undone).toMatchObject({ code: undefined, data: { undoDesignChange: { undone: true, canUndo: false } } })
    const after = await draft(t.storeA1)
    expect(after?.head_commit).not.toBe(before?.head_commit)
    expect(after?.preview_deploy_ref).not.toBe(before?.preview_deploy_ref)
    expect((await texts('owner'))?.find((e) => e.key === 'pages:home.lead')?.text).toBe('Last one in.')
  })

  it('discards back to the live version: the draft row and bundle go, the preview shows live code, the studio reloads it', async () => {
    expect((await w.gql('owner', 'mutation { discardDraft }')).code).toBe('NOTHING_TO_DISCARD')
    // A live build whose source is the draft as it was after its first change.
    const liveHead = (await db.sql<{ commits: string[] }[]>`select to_jsonb(commits) as commits from design_draft where store_id = ${t.storeA1}`)[0]?.commits[0] ?? ''
    const [run] = await db.sql<{ id: string }[]>`
      insert into publish_run (store_id, kind, state, commit, template, core_version, uses_allowance, started_by_kind, created_at, finished_at)
      values (${t.storeA1}, 'design', 'live', ${liveHead}, 'baseline', ${core}, false, 'system', now(), now()) returning id`
    const source = objects.get(draftBundle(t.storeA1))
    if (!source) throw new Error('no draft bundle')
    objects.set(sourceBundle(t.storeA1, run?.id ?? ''), source)
    await db.sql`update storefront set live_build_id = ${run?.id ?? null} where store_id = ${t.storeA1}`
    expect((await w.gql('manager', 'mutation { discardDraft }')).code).toBe('FORBIDDEN')
    expect(await w.gql('owner', 'mutation { discardDraft }')).toMatchObject({ code: undefined, data: { discardDraft: true } })
    expect(await draft(t.storeA1)).toBeNull()
    expect(objects.has(draftBundle(t.storeA1))).toBe(false)
    expect((await db.sql<{ folder: string | null }[]>`select d.preview_deploy_ref as folder from storefront f left join design_draft d on d.store_id = f.store_id where f.store_id = ${t.storeA1}`)[0]?.folder).toBeNull()
    expect((await texts('owner'))?.find((e) => e.key === 'pages:home.lead')?.text).toBe('Warm linen, cut slowly.')
    expect((await db.sql<{ text: string }[]>`select text from design_message where store_id = ${t.storeA1} and role = 'note' order by created_at desc limit 1`)[0]?.text).toBe('discarded')
  })

  it('marks an attached image for shoppers only when the change lands, not for a stopped or unchanged one', async () => {
    const [made] = await db.sql<{ id: string }[]>`insert into asset (store_id, r2_key, kind, mime, bytes, checksum) values (${t.storeA1}, ${`stores/${t.storeA1}/assets/${crypto.randomUUID()}.png`}, 'image', 'image/png', 10, ${'0'.repeat(64)}) returning id`
    const id = made?.id ?? ''
    const used = await usage(t.storeA1)
    await db.sql`update store_usage set used = 0 where store_id = ${t.storeA1} and key = 'ai_prompts'`
    const visible = async () => (await db.sql<{ v: boolean }[]>`select storefront_visible as v from asset where id = ${id}`)[0]?.v
    design.readAsset = async () => ({ bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png' })
    let release: () => void = () => undefined
    try {
      hold = new Promise<void>((resolve) => (release = resolve))
      const reached = new Promise<void>((resolve) => (held = resolve))
      const asking = ask('owner', 'Use this', { image: id })
      await reached
      await w.gql('owner', 'mutation { cancelDesign }')
      expect((await asking).data?.['askDesign']).toMatchObject({ outcome: 'cancelled' })
      expect(await visible()).toBe(false)
    } finally {
      release()
      hold = null
      held = null
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    script.answers = [reply([lead('Linen, no photo.')])]
    expect((await ask('owner', 'Like this', { image: id })).data?.['askDesign']).toMatchObject({ outcome: 'changed' })
    expect(await visible(), 'attached but unused').toBe(false)
    await db.sql`update store_usage set used = 0 where store_id = ${t.storeA1} and key = 'ai_prompts'`
    script.answers = [reply([lead(`Linen, with ${id}.`)])]
    const landed = await ask('owner', 'Use this', { image: id })
    expect(landed.data?.['askDesign'], JSON.stringify(landed)).toMatchObject({ outcome: 'changed' })
    expect(await visible(), 'named by the change').toBe(true)
    design.readAsset = null
    await db.sql`update store_usage set used = ${used} where store_id = ${t.storeA1} and key = 'ai_prompts'`
  })
})

describe('the studio session', () => {
  it('opens the frame on the store’s own preview origin, read-only for the Manager; Staff and suppliers are refused', async () => {
    const opened = await w.gql('owner', '{ studioSession { state session frameUrl access } }')
    const view = opened.data?.['studioSession'] as { state: string; session: string; frameUrl: string; access: string }
    const [key] = await db.sql<{ slug: string }[]>`select slug from store where id = ${t.storeA1}`
    expect(view).toMatchObject({ state: 'ready', access: 'change', frameUrl: `https://${key?.slug}-preview.my-store.one/__studio/${view.session}/` })
    const again = await w.gql('owner', 'query S($s: String) { studioSession(session: $s) { session } }', { s: view.session })
    expect((again.data?.['studioSession'] as { session: string }).session).toBe(view.session)
    expect((await w.gql('manager', '{ studioSession { access } }')).data?.['studioSession']).toEqual({ access: 'view' })
    for (const who of ['staff', 'supplier'] as const) expect((await w.gql(who, '{ studioSession { access } }')).code).toBe('FORBIDDEN')
    expect(local.calls.every((c) => c.storeId === c.contextStore)).toBe(true)
  })

  it('renews only while the seat holds: a removed user’s renewal is refused and the session ends; signing out ends it at once', async () => {
    await db.sql`delete from studio_session where user_id = ${w.people.manager}`
    const session = ((await w.gql('manager', '{ studioSession { session } }')).data?.['studioSession'] as { session: string }).session
    const renew = (who: Who) => w.gql(who, 'mutation R($s: String!) { renewStudioSession(session: $s) }', { s: session })
    expect((await renew('manager')).code).toBeUndefined()
    // Another person's renewal of it never extends it.
    expect((await renew('owner')).code).toBe('SESSION_ENDED')
    const sessions = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from studio_session where user_id = ${w.people.manager}`)[0]?.n
    expect(await sessions()).toBe(1)
    await db.sql`update membership set status = 'removed' where user_id = ${w.people.manager}`
    expect((await renew('manager')).code).toBe('SESSION_ENDED')
    expect(await sessions()).toBe(0)
    await db.sql`update membership set status = 'active' where user_id = ${w.people.manager}`
    await w.gql('manager', '{ studioSession { session } }')
    expect(await sessions()).toBe(1)
    await db.sql`delete from user_session where user_id = ${w.people.manager}`
    expect(await sessions()).toBe(0)
  })
})

describe('choosing the model', () => {
  it("runs on the model the Owner picked from the account's list, and refuses one it doesn't list", async () => {
    script.answers = [reply([], 'Nothing to change.')]
    await ask('owner', 'Keep it as it is', { model: 'claude-haiku-5-5' })
    expect(askedModel).toBe('claude-haiku-5-5')
    const before = await usage(t.storeA1)
    expect((await ask('owner', 'Keep it as it is', { model: 'gpt-5' })).code).toBe('INVALID_INPUT')
    expect(await usage(t.storeA1)).toBe(before)
    expect((await w.gql('owner', 'query { studioSession { models } }')).data?.['studioSession']).toMatchObject({ models: ['claude-opus-5-5', 'claude-haiku-5-5'] })
  })
})
