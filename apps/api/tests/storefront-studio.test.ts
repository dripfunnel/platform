import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AiAnswer, AiProvider } from '#integrations/ai/index'
import type { Screenshotter } from '#integrations/cloudflare/screenshot'
import type { DnsLookup } from '#integrations/dns/doh'
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
const script: { answers: string[]; sent: string[] } = { answers: [], sent: [] }
const reply = (files: { path: string; content: string | null }[], words = 'I made the lead warmer.') => JSON.stringify({ files, reply: words, changed: ['Hero lead'], page: 'home' })
const provider: AiProvider = {
  complete: async (call): Promise<AiAnswer> => {
    script.sent.push(call.text)
    const text = script.answers.shift() ?? reply([])
    return { text, model: 'fake-model', tokensIn: 1000, tokensOut: 200, costAmount: 1, costCurrency: 'USD' }
  },
}
let aiMode: 'plan' | 'none' = 'plan'
/** The studio's RPC fails before it reaches the model (a Durable Object fault). */
let studioDown = false
/** The world's design deps; a test sets the screenshotter, which sits behind the SSRF check (docs/ARCHITECTURE.md §7). */
const design: { ai: (billedTo: 'plan' | 'own_key') => AiProvider | null; screenshots: Screenshotter | null; readAsset: null } = {
  ai: (billedTo) => (aiMode === 'plan' && billedTo === 'plan' ? provider : null),
  screenshots: null,
  readAsset: null,
}
const dns: Record<string, string[]> = { 'shop.example.com A': ['93.184.216.34'], 'inside.example.com A': ['10.1.2.3'] }
const lookup: DnsLookup = { resolve: async (name, type) => dns[`${name} ${type}`] ?? [] }

const enPages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''
const lead = (words: string) => ({ path: 'content/en/pages.json', content: enPages().replace(/"lead": "[^"]*"/, `"lead": "${words}"`) })
const refusedPage = { path: 'src/theme/pages/HomePage.tsx', content: "export const HomePage = () => { fetch('/x'); return null }\n" }

const ask = (who: Who, text: string, extra: Record<string, unknown> = {}) =>
  w.gql(who, 'mutation A($text: String!, $image: ID, $site: String) { askDesign(text: $text, imageAssetId: $image, sampleUrl: $site, page: "home", device: "desktop") { outcome message { id role text changed page canUndo } } }', { text, ...extra })
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
    extra: { preview: { domain: 'webpreview.store', links: { seal: async () => 'x', open: async () => null } }, design },
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
      const lost = await ask('owner', 'Lost on the way'); console.log('LOST', JSON.stringify(lost)); expect(lost.data?.['askDesign']).toMatchObject({ outcome: 'failed', message: { role: 'error' } })
    } finally {
        studioDown = false
    }
    expect(script.sent.length).toBe(sent)
    expect(await usage(t.storeA1)).toBe(used)
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
})

describe('the studio session', () => {
  it('opens the frame on the store’s own preview origin, read-only for the Manager; Staff and suppliers are refused', async () => {
    const opened = await w.gql('owner', '{ studioSession { state session frameUrl access } }')
    const view = opened.data?.['studioSession'] as { state: string; session: string; frameUrl: string; access: string }
    const [key] = await db.sql<{ preview_key: string }[]>`select preview_key from storefront where store_id = ${t.storeA1}`
    expect(view).toMatchObject({ state: 'ready', access: 'change', frameUrl: `https://${key?.preview_key}.webpreview.store/__studio/${view.session}/` })
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
