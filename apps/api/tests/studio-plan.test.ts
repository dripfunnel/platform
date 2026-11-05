import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AiAnswer, AiProvider } from '#integrations/ai/index'
import { StudioRunner, type DraftsBucket, type FileEdit } from '#saas/studio/index'
import type { CallerContext } from '#core/tenancy'
import { moveFlow } from '#db/scoped/design'
import { withScope } from '#db/scoped/index'
import { studioStorage } from './support/kept'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { sandboxProcess, type SandboxProcess } from './support/sandboxProcess'
import { fakeSites, putText, type FakeSites } from './support/sites'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'
import { localStudio } from './support/studio'

// Card #1243: a vague request's quick questions, its plan and the page-by-page build (storefront AI-STUDIO §4 "A plan";
// SAAS §9.2): a fake model, the real sandbox (apps/sandbox in its own process) and the real database; R2 in memory.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 180_000 })

const core = '0.4.0'
const baselineDir = fileURLToPath(new URL('../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))
let clock = Date.parse('2026-11-05T09:00:00.000Z')
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
    ...studioStorage(),
  })
  runners.set(storeId, runner)
  return runner
}
const local = localStudio(() => db.sql, runnerOf)
/** The studio's RPC fails before a build starts (a Durable Object fault). */
let studioFails = false

/** The model as a script: each call takes the next answer and records what it was sent. */
const script: { answers: string[]; sent: string[] } = { answers: [], sent: [] }
/** When set, a call whose text contains `at` waits on `wait`, so a test can press Stop mid-build. */
let pause: { at: string; wait: Promise<void>; reached: () => void } | null = null
const answerFor = async (text: string) => {
  script.sent.push(text)
  if (pause && text.includes(pause.at)) {
    pause.reached()
    await pause.wait
  }
  return script.answers.shift() ?? JSON.stringify({ files: [], reply: 'Nothing to change.', changed: [], page: 'home' })
}
const provider: AiProvider = {
  complete: async (call): Promise<AiAnswer> => ({ text: await answerFor([...(call.context ?? []), call.text].join('\n\n')), model: 'fake-model', tokensIn: 1000, tokensOut: 200, costAmount: 1, costCurrency: 'USD' }),
  converse: async (call) => {
    const first = call.messages[0]?.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n') ?? ''
    return { text: await answerFor(first), toolCalls: [], wantsTools: false, model: 'fake-model', tokensIn: 1000, tokensOut: 200, costAmount: 1, costCurrency: 'USD' }
  },
}
const design = {
  ai: () => provider,
  models: () => [],
  screenshots: null,
  readAsset: null,
  stock: null,
  aiPhotos: [],
}

const enPages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''
const lead = (words: string) => ({ path: 'content/en/pages.json', content: enPages().replace(/"lead": "[^"]*"/, `"lead": "${words}"`) })
const reply = (files: FileEdit[], words = 'I built this page.') => JSON.stringify({ files, reply: words, changed: ['Page'], page: 'home' })
const refusedPage = { path: 'src/theme/pages/HomePage.tsx', content: "export const HomePage = () => { fetch('/x'); return null }\n" }
const questions = JSON.stringify({
  questions: [
    { text: 'What should the home page lead with?', options: ['Silk Sarees, your best collection', 'Your newest arrivals'] },
    { text: 'What feeling should the store have?', options: ['Calm and premium', 'Bold and modern', 'Warm and handmade'] },
  ],
  reply: 'A few quick questions so I build the right thing.',
})
const pages = [
  { page: 'about', title: 'About', sections: ['the story behind the silk'] },
  { page: 'product', title: 'Product', sections: ['large gallery with zoom'] },
  { page: 'home', title: 'Home', sections: ['hero with Silk Sarees', '3 collection tiles'] },
]
const planned = JSON.stringify({ plan: { header: 'logo and a short menu', footer: 'shipping and contact', pages }, reply: 'Here is my plan.' })

const fields = 'outcome message { id role text changed canUndo flowState questions { text options } answers plan { header footer pages { page title sections } } build { pages { page title outcome } stopped } }'
type Answer = { outcome: string; message: { id: string; role: string; text: string; changed: string[]; canUndo: boolean; flowState: string | null; questions: { text: string; options: string[] }[]; answers: (string | null)[]; plan: { pages: { page: string }[] } | null; build: { pages: { page: string; title: string; outcome: string }[]; stopped: boolean } | null } }
const ask = async (who: Who, text: string) => w.gql(who, `mutation A($text: String!) { askDesign(text: $text, page: "home", device: "desktop") { ${fields} } }`, { text })
const answer = async (id: string, answers: string[], skip = false) => w.gql('owner', `mutation Q($id: ID!, $a: [String!]!, $s: Boolean) { answerDesignQuestions(messageId: $id, answers: $a, skip: $s) { ${fields} } }`, { id, a: answers, s: skip })
const change = async (id: string, text: string) => w.gql('owner', `mutation C($id: ID!, $t: String!) { changeDesignPlan(messageId: $id, text: $t) { ${fields} } }`, { id, t: text })
const build = async (id: string) => w.gql('owner', `mutation B($id: ID!) { buildDesignPlan(messageId: $id) { ${fields} } }`, { id })
const value = (r: Awaited<ReturnType<typeof ask>>, field: string) => r.data?.[field] as Answer
const usage = async (storeId: string) => (await db.sql<{ used: number }[]>`select used from store_usage where store_id = ${storeId} and key = 'ai_prompts'`)[0]?.used ?? 0
const head = async (storeId: string) => (await db.sql<{ head_commit: string }[]>`select head_commit from design_draft where store_id = ${storeId}`)[0]?.head_commit ?? null
const shownLead = async () => (await w.gql('owner', 'query { designText(page: "home", locale: "en-IN") { key text } }')).data?.['designText'] as { key: string; text: string }[]
const leadNow = async () => (await shownLead()).find((e) => e.key === 'pages:home.lead')?.text
const pageEvents = (storeId: string) => {
  const mine = local.live.filter((e) => e.storeId === storeId)
  const run = mine.at(-1)?.run
  return mine.filter((e) => e.run === run).flatMap((e) => (e.event.type === 'page' ? [`${e.event.index}/${e.event.of} ${e.event.page}`] : []))
}

/** A vague request through to an open plan, three pages planned; resolves the plan's message. */
const toPlan = async (): Promise<Answer['message']> => {
  script.answers = [questions, planned]
  const asked = value(await ask('owner', 'Make my store look premium'), 'askDesign')
  const planning = value(await answer(asked.message.id, ['Silk Sarees, your best collection', '']), 'answerDesignQuestions')
  return planning.message
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: { resolve: async () => [] }, studio: (context) => {
      const studio = local.studio(context)
      return { ...studio, build: (storeId, input, model) => (studioFails ? Promise.reject(new Error('the studio is unreachable')) : studio.build(storeId, input, model)) }
    }, extra: { preview: { domain: 'my-store.one', links: { seal: async () => 'x', open: async () => null } }, design } })
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
  await db.sql`insert into collection (store_id, name, slug, kind) values (${t.storeA1}, 'Silk Sarees', 'silk-sarees', 'manual'), (${t.storeB1}, 'Velvet Capes', 'velvet-capes', 'manual')`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_mode', 1 from store where plan_id is not null`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_prompts', 50 from store where plan_id is not null`
  // The studio opens first, which keeps the store summary the questions are prefilled from (#1242).
  for (const who of ['owner', 'bOwner'] as const) await w.gql(who, 'query { studioSession { state } }')
}, 180_000)

afterAll(async () => {
  await host?.close()
  await db?.drop()
})

describe('a vague request (#1243)', () => {
  it('gets at most 3 questions, from a model given the store’s own data and never another store’s; nothing changes', async () => {
    script.answers = [questions]
    const before = await head(t.storeA1)
    const asked = await ask('owner', 'Make my store look premium')
    expect(asked).toMatchObject({ code: undefined, data: { askDesign: { outcome: 'asked', message: { role: 'questions', text: 'A few quick questions so I build the right thing.', flowState: 'open', canUndo: false } } } })
    const q = value(asked, 'askDesign').message
    expect(q.questions).toHaveLength(2)
    expect(q.questions[0]).toEqual({ text: 'What should the home page lead with?', options: ['Silk Sarees, your best collection', 'Your newest arrivals'] })
    expect(script.sent.at(-1)).toContain('Silk Sarees')
    expect(script.sent.at(-1)).not.toContain('Velvet Capes')
    expect(await head(t.storeA1)).toBe(before)
    const [run] = await db.sql<{ kind: string; outcome: string; parent_run_id: string | null }[]>`select kind, outcome, parent_run_id from ai_run where store_id = ${t.storeA1} order by created_at desc limit 1`
    expect(run).toEqual({ kind: 'design', outcome: 'unchanged', parent_run_id: null })
  })

  it('keeps store B’s questions to store B’s data', async () => {
    script.answers = [questions]
    expect(value(await ask('bOwner', 'A fresh design'), 'askDesign').outcome).toBe('asked')
    expect(script.sent.at(-1)).toContain('Velvet Capes')
    expect(script.sent.at(-1)).not.toContain('Silk Sarees')
  })

  it('applies a clear request at once, with no questions', async () => {
    script.answers = [reply([lead('Maroon buttons.')], 'I made the buttons maroon.')]
    const done = await ask('owner', 'make the buttons maroon')
    expect(done).toMatchObject({ code: undefined, data: { askDesign: { outcome: 'changed', message: { role: 'ai', text: 'I made the buttons maroon.', questions: [], plan: null } } } })
  })
})

describe('the plan and its build (#1243)', () => {
  it('answers the questions with a plan, once: a second answer and an old message are refused', async () => {
    script.answers = [questions, planned]
    const asked = value(await ask('owner', 'Make my store look premium'), 'askDesign').message
    const planning = await answer(asked.id, ['Silk Sarees, your best collection', 'my own words'])
    expect(planning).toMatchObject({ code: undefined, data: { answerDesignQuestions: { outcome: 'asked', message: { role: 'plan', text: 'Here is my plan.', flowState: 'open' } } } })
    expect(script.sent.at(-1)).toContain('What feeling should the store have? my own words')
    expect((await answer(asked.id, [])).code).toBe('PLAN_GONE')
    const [row] = await db.sql<{ detail: { state: string } }[]>`select detail from design_message where id = ${asked.id}`
    expect(row?.detail.state).toBe('answered')
  })

  it('takes a skip and changes the plan in words, at most three times, all inside one prompt unit', async () => {
    script.answers = [questions, planned]
    const used = await usage(t.storeA1)
    const asked = value(await ask('owner', 'A new look'), 'askDesign').message
    let plan = value(await answer(asked.id, [], true), 'answerDesignQuestions').message
    expect(script.sent.at(-1)).toContain('They skipped the questions')
    for (let n = 0; n < 3; n += 1) {
      script.answers = [planned]
      const changed = await change(plan.id, `add page ${n}`)
      expect(changed.code).toBeUndefined()
      expect((await change(plan.id, 'again')).code).toBe('PLAN_GONE')
      plan = value(changed, 'changeDesignPlan').message
    }
    expect((await change(plan.id, 'a fourth')).code).toBe('PLAN_CHANGES_USED')
    expect(await usage(t.storeA1)).toBe(used + 1)
  })

  it('builds every planned page, home first, each through the gate, as one prompt unit with a run per page under the first', async () => {
    const plan = await toPlan()
    const used = await usage(t.storeA1)
    const before = await head(t.storeA1)
    script.answers = [reply([lead('Home, built.')], 'I built the home page.'), reply([lead('Product, built.')]), reply([lead('About, built.')])]
    const built = await build(plan.id)
    expect(built).toMatchObject({ code: undefined, data: { buildDesignPlan: { outcome: 'changed', message: { role: 'ai', canUndo: true, changed: ['Home', 'Product', 'About'], build: { stopped: false } } } } })
    expect(value(built, 'buildDesignPlan').message.build?.pages.map((p) => `${p.page} ${p.outcome}`)).toEqual(['home changed', 'product changed', 'about changed'])
    expect(pageEvents(t.storeA1)).toEqual(['1/3 home', '2/3 product', '3/3 about'])
    expect(script.sent.at(-3)).toContain('Build page 1 of 3 of the plan the merchant agreed: the Home page (home)')
    expect(script.sent.at(-3)).toContain('never with questions or a plan')
    expect(await leadNow()).toBe('About, built.')
    expect(await head(t.storeA1)).not.toBe(before)
    expect(await usage(t.storeA1)).toBe(used)
    const [root] = await db.sql<{ id: string }[]>`select ai_run_id as id from design_message where id = ${plan.id}`
    const children = await db.sql<{ kind: string; billed_to: string }[]>`select kind, billed_to from ai_run where parent_run_id = ${root?.id ?? ''} order by created_at`
    // The plan's own call, then one run per page; the merchant's, never the platform's.
    expect(children.map((r) => `${r.kind}:${r.billed_to}`)).toEqual(['design:plan', 'design:plan', 'design:plan', 'design:plan'])
    expect((await build(plan.id)).code).toBe('PLAN_GONE')
  })

  it('undoes the whole build in one change', async () => {
    const plan = await toPlan()
    // A plain change after the plan is still before the build: the plan stays the newest one to build.
    script.answers = [reply([lead('Before the build.')], 'A change first.')]
    await ask('owner', 'set the lead')
    script.answers = [reply([lead('Built home.')]), reply([lead('Built product.')]), reply([lead('Built about.')])]
    const built = value(await build(plan.id), 'buildDesignPlan').message
    expect(await leadNow()).toBe('Built about.')
    const undone = await w.gql('owner', 'mutation U($id: ID!) { undoDesignChange(messageId: $id) { undone canUndo } }', { id: built.id })
    expect(undone).toMatchObject({ code: undefined, data: { undoDesignChange: { undone: true, canUndo: false } } })
    expect(await leadNow()).toBe('Before the build.')
  })

  it('stops after the page being built when Stop is pressed: pages 1 and 2 stay and are listed', async () => {
    const plan = await toPlan()
    let release: () => void = () => undefined
    const wait = new Promise<void>((resolve) => (release = resolve))
    let reached: () => void = () => undefined
    const atPage2 = new Promise<void>((resolve) => (reached = resolve))
    pause = { at: 'Build page 2 of 3', wait, reached }
    script.answers = [reply([lead('Stop: home.')]), reply([lead('Stop: product.')]), reply([lead('Never built.')])]
    try {
      const building = build(plan.id)
      await atPage2
      expect((await w.gql('owner', 'mutation { cancelDesign }')).data?.['cancelDesign']).toBe(true)
      release()
      const done = value(await building, 'buildDesignPlan')
      expect(done.outcome).toBe('changed')
      expect(done.message.build).toEqual({ stopped: true, pages: [{ page: 'home', title: 'Home', outcome: 'changed' }, { page: 'product', title: 'Product', outcome: 'changed' }, { page: 'about', title: 'About', outcome: 'left' }] })
      expect(done.message.changed).toEqual(['Home', 'Product'])
    } finally {
      release()
      pause = null
    }
    expect(await leadNow()).toBe('Stop: product.')
    script.answers = []
  })

  it('stops cleanly at a refused page, keeping the pages before it', async () => {
    const plan = await toPlan()
    script.answers = [reply([lead('Refused build: home.')]), reply([refusedPage]), reply([refusedPage]), reply([refusedPage]), reply([refusedPage])]
    const done = value(await build(plan.id), 'buildDesignPlan')
    expect(done.outcome).toBe('changed')
    expect(done.message.build?.pages.map((p) => p.outcome)).toEqual(['changed', 'refused', 'left'])
    expect(await leadNow()).toBe('Refused build: home.')
  })

  it('opens again questions or a plan whose request ended without moving them on, once the claim is 25 minutes old', async () => {
    script.answers = [questions]
    const asked = value(await ask('owner', 'A premium look'), 'askDesign').message
    const claim = async (id: string, state: string, minutesAgo: number) => {
      const claimedAt = new Date(clock - minutesAgo * 60_000).toISOString()
      await db.sql`update design_message set detail = detail || ${db.sql.json({ state, claimedAt })} where id = ${id}`
    }
    await claim(asked.id, 'answered', 1)
    expect((await answer(asked.id, [], true)).code).toBe('PLAN_GONE')
    await claim(asked.id, 'answered', 26)
    script.answers = [planned]
    const plan = value(await answer(asked.id, [], true), 'answerDesignQuestions').message
    expect(plan.role).toBe('plan')
    await claim(plan.id, 'building', 1)
    expect((await build(plan.id)).code).toBe('PLAN_GONE')
    await claim(plan.id, 'building', 26)
    script.answers = [reply([lead('Reopened: home.')]), reply([lead('Reopened: product.')]), reply([lead('Reopened: about.')])]
    expect(value(await build(plan.id), 'buildDesignPlan').outcome).toBe('changed')
    // A built plan never opens again, however old its claim.
    await claim(plan.id, 'built', 60)
    expect((await build(plan.id)).code).toBe('PLAN_GONE')
  })

  it('gives a plan back to build again when the build fails before any page', async () => {
    const plan = await toPlan()
    script.answers = []
    studioFails = true
    try {
      expect(value(await build(plan.id), 'buildDesignPlan').outcome).toBe('failed')
    } finally {
      studioFails = false
    }
    const [row] = await db.sql<{ detail: { state: string; claimedAt: string | null } }[]>`select detail from design_message where id = ${plan.id}`
    expect(row?.detail).toMatchObject({ state: 'open', claimedAt: null })
  })

  it('moves a flow only in its own store’s scope: store A’s context never moves store B’s, nor a supplier’s', async () => {
    script.answers = [questions]
    const theirs = value(await ask('bOwner', 'A new look for B'), 'askDesign').message
    const [row] = await db.sql<{ detail: Record<string, unknown> }[]>`select detail from design_message where id = ${theirs.id}`
    const detail = row?.detail ?? {}
    const as = (storeId: string, partnerId: string, seller: boolean): CallerContext => ({ caller: { kind: 'person', userId: 'u', sessionId: 's' }, partnerId, storeId, sellerScope: seller ? { kind: 'seller', sellerId: t.sellerA1First } : { kind: 'all' }, subscription: 'active' })
    const claimed = { ...detail, state: 'answered', claimedAt: new Date(clock).toISOString() }
    // Even naming store B's id, store A's scope sees no row to move.
    expect(await withScope(db.sql, as(t.storeA1, t.partnerA, false), (tx) => moveFlow(tx, t.storeB1, theirs.id, { state: 'open' }, claimed))).toBe(false)
    expect(await withScope(db.sql, as(t.storeB1, t.partnerB, true), (tx) => moveFlow(tx, t.storeB1, theirs.id, { state: 'open' }, claimed)).catch(() => false)).toBe(false)
    expect((await db.sql<{ state: string }[]>`select detail->>'state' as state from design_message where id = ${theirs.id}`)[0]?.state).toBe('open')
    expect(await withScope(db.sql, as(t.storeB1, t.partnerB, false), (tx) => moveFlow(tx, t.storeB1, theirs.id, { state: 'open' }, claimed))).toBe(true)
  })

  it('refuses the Manager, and another store’s Owner, every flow write', async () => {
    const plan = await toPlan()
    expect((await w.gql('manager', 'mutation B($id: ID!) { buildDesignPlan(messageId: $id) { outcome } }', { id: plan.id })).code).toBe('FORBIDDEN')
    expect((await w.gql('bOwner', 'mutation B($id: ID!) { buildDesignPlan(messageId: $id) { outcome } }', { id: plan.id })).code).toBe('PLAN_GONE')
    expect((await w.gql('bOwner', 'mutation C($id: ID!) { changeDesignPlan(messageId: $id, text: "x") { outcome } }', { id: plan.id })).code).toBe('PLAN_GONE')
  })
})
