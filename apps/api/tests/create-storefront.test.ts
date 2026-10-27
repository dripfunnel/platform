import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProvisioningStep } from '#db/schema/saas'
import type { CallerContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { createGitHubApp } from '#integrations/github/index'
import { localGitHub, type LocalGitHub } from '#integrations/local/github'
import { storefrontCreateDeliverer, storefrontUndoDeliverer, type StorefrontWorkflow } from '#jobs/queues/deliverers/storefrontCreate'
import { createFailedMessage, runCreateStorefront, startStorefront, storefrontCreateKind, type CreateDeps, type CreateStorefrontParams, type StepRunner } from '#saas/storefronts/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeSites, putText, type FakeSites } from './support/sites'

// INF 1 (#316): SAAS §5 steps 4–8 against the real database, GitHub answered in memory by the stand-in the App's real
// client talks to, and an in-memory sites bucket. Every step is idempotent, and a failure anywhere leaves nothing.

let db: TestDatabase
let t: Tenants
let github: LocalGitHub
let sites: FakeSites
let deps: CreateDeps
const at = new Date('2026-10-11T10:00:00Z')
const core = '1.4.0'
const lockedWorkflow = readFileSync(new URL('../../../templates/storefront/.github/workflows/build.yml', import.meta.url), 'utf8')
const npmrc = readFileSync(new URL('../../../templates/storefront/.npmrc', import.meta.url), 'utf8')
const steps: readonly ProvisioningStep[] = ['repo', 'storeConfig', 'hostingTarget', 'firstBuild', 'done']

const once: StepRunner = { do: (_, work) => work() }

/** A Workflow's step retries: each step runs again after a throw, up to three times. */
const retrying: StepRunner = {
  do: async (_, work) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work()
      } catch (error) {
        if (attempt >= 3) throw error
      }
    }
  },
}

const preview = { 'index.html': '<!doctype html><title>Bloom</title>', 'assets/app.js': 'console.log(1)' }

/** What the release workflow uploads for a core version (storefront ARCHITECTURE §2.3). */
const uploadTemplates = async (version = core) => {
  await putText(sites, 'templates/current.json', JSON.stringify({ core: version }))
  const skeleton = [
    { path: 'package.json', content: JSON.stringify({ name: '@dripfunnel/storefront-template', private: true, dependencies: { '@dripfunnel/storefront-core': 'workspace:*', next: '^16.3.6' } }) },
    { path: '.github/workflows/build.yml', content: lockedWorkflow },
    { path: '.npmrc', content: npmrc },
    { path: 'next.config.ts', content: 'export default {}\n' },
    { path: 'src/app/layout.tsx', content: 'export default function Layout() { return null }\n' },
  ]
  await putText(sites, `templates/${version}/skeleton.json`, JSON.stringify({ files: skeleton }))
  const theme = [
    { path: 'routes.json', content: '{"routes":{"home":"HomePage"}}' },
    { path: 'src/theme/pages/HomePage.tsx', content: 'export const HomePage = () => null\n' },
    { path: 'content/en/home.json', content: '{"title":"Bloom"}' },
  ]
  await putText(sites, `templates/${version}/themes/bloom/source.json`, JSON.stringify({ files: theme }))
  const files = []
  for (const [path, text] of Object.entries(preview)) files.push({ path, sha256: await putText(sites, `templates/${version}/themes/bloom/preview/files/${path}`, text, path.endsWith('.html') ? 'text/html' : 'text/javascript') })
  await putText(sites, `templates/${version}/themes/bloom/preview/manifest.json`, JSON.stringify({ files }))
}

const start = (storeId: string, template = 'bloom') => withSystemScope(db.sql, (tx) => startStorefront(tx, storeId, template, at))

const started = async (storeId: string, template = 'bloom') => {
  const result = await start(storeId, template)
  if (!result.ok) throw new Error(`start refused: ${result.code}`)
  return { storeId, jobId: result.jobId, template }
}

const storefront = async (storeId: string) =>
  (await db.sql<{ repo: string | null; repo_id: string | null; repo_state: string; repo_head: string | null; template: string | null; public_store_key: string }[]>`
    select repo, repo_id::text as repo_id, repo_state, repo_head, template, public_store_key from storefront where store_id = ${storeId}`)[0]

const job = async (jobId: string) => (await db.sql<{ state: string; step: string; last_error: string | null; kind: string; steps: string[] }[]>`select state, step, last_error, kind, to_jsonb(steps) as steps from job where id = ${jobId}`)[0]

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
})

afterAll(async () => {
  await db.drop()
})

beforeEach(async () => {
  github = localGitHub({ org: 'dripfunnel', installationId: '42', appId: '7' })
  sites = fakeSites()
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey))))}\n-----END PRIVATE KEY-----`
  deps = { sql: db.sql, github: createGitHubApp({ appId: '7', installationId: '42', privateKey: pem, fetchImpl: github.fetch, sleep: async () => undefined }), org: 'dripfunnel', sites, shopDomain: 'my-store.one', now: () => at }
  await uploadTemplates()
  await db.sql`delete from design_draft`
  await db.sql`delete from storefront_push`
  await db.sql`update storefront set repo = null, repo_state = 'none', repo_head = null, template = null`
  await db.sql`update store set storefront_kind = 'ai', core_version = null`
})

describe('choosing a template the first time', () => {
  it('names the repo opaquely, starts one job, and asks for the Workflow through the outbox', async () => {
    const result = await start(t.storeA1)
    expect(result).toEqual({ ok: true, jobId: expect.any(String) })
    const row = await storefront(t.storeA1)
    expect(row?.repo).toMatch(/^sf-[a-z0-9]{10}$/)
    expect(row?.repo_state).toBe('creating')
    const jobId = result.ok ? result.jobId : ''
    expect(await job(jobId)).toMatchObject({ kind: 'create-storefront', state: 'running', step: 'repo', steps })
    const outbox = await db.sql<{ payload: unknown; store_id: string }[]>`select payload, store_id from outbox where kind = ${storefrontCreateKind}`
    expect(outbox).toEqual([{ payload: { storeId: t.storeA1, jobId, template: 'bloom' }, store_id: t.storeA1 }])
    // A second press while it runs is the same job.
    expect(await start(t.storeA1)).toEqual(result)
  })

  it('never makes a repo for a store with its own frontend, twice for one that has one, or for a template name it can’t read', async () => {
    await db.sql`update store set storefront_kind = 'own' where id = ${t.storeA2}`
    expect(await start(t.storeA2)).toEqual({ ok: false, code: 'OWN_FRONTEND' })
    expect(await start(t.storeB1, '../bloom')).toEqual({ ok: false, code: 'INVALID_TEMPLATE' })
    await db.sql`update storefront set repo_state = 'ready' where store_id = ${t.storeB1}`
    expect(await start(t.storeB1)).toEqual({ ok: false, code: 'ALREADY_CREATED' })
  })

  it('starts the Workflow once per job, however often the outbox delivers', async () => {
    const created: string[] = []
    const workflow: StorefrontWorkflow = {
      get: async (id) => {
        if (!created.includes(id)) throw new Error('instance.not_found')
        return {} as WorkflowInstance
      },
      create: async (options?: WorkflowInstanceCreateOptions<CreateStorefrontParams>) => {
        created.push(options?.id ?? '')
        return {} as WorkflowInstance
      },
    }
    const deliverer = storefrontCreateDeliverer(workflow)
    const params = { storeId: t.storeA1, jobId: '6d1c4f8e-0a7b-4f43-9a8e-2b6c1d0e9f71', template: 'bloom' }
    const effect = { id: 'e', kind: storefrontCreateKind, idempotencyKey: 'k', payload: params, partnerId: t.partnerA, storeId: t.storeA1, attempt: 1 }
    await deliverer.deliver(effect, new AbortController().signal)
    await deliverer.deliver(effect, new AbortController().signal)
    expect(created).toEqual([params.jobId])
    await expect(deliverer.deliver({ ...effect, payload: { ...params, extra: 1 } }, new AbortController().signal)).rejects.toThrow(/bad_payload/)
  })
})

describe('an Admin Undo', () => {
  it('starts the Workflow once per job under an instance of its own, however often the outbox delivers', async () => {
    const created: string[] = []
    const workflow: StorefrontWorkflow = {
      get: async (id) => {
        if (!created.includes(id)) throw new Error('instance.not_found')
        return {} as WorkflowInstance
      },
      create: async (options?: WorkflowInstanceCreateOptions<unknown>) => {
        created.push(options?.id ?? '')
        return {} as WorkflowInstance
      },
    }
    const deliverer = storefrontUndoDeliverer(workflow)
    const params = { storeId: t.storeA1, jobId: '6d1c4f8e-0a7b-4f43-9a8e-2b6c1d0e9f71' }
    const effect = { id: 'e', kind: 'storefront.undo', idempotencyKey: 'k', payload: params, partnerId: t.partnerA, storeId: t.storeA1, attempt: 1 }
    await deliverer.deliver(effect, new AbortController().signal)
    await deliverer.deliver(effect, new AbortController().signal)
    expect(created).toEqual([`undo-${params.jobId}`])
    await expect(deliverer.deliver({ ...effect, payload: { ...params, template: 'bloom' } }, new AbortController().signal)).rejects.toThrow(/bad_payload/)
  })
})

describe('the create-storefront Workflow', () => {
  it('creates a filled public repo with the locked workflow, the generated files and the pinned core, and the first preview', async () => {
    const params = await started(t.storeA1)
    expect(await runCreateStorefront(deps, params, once)).toBe('created')
    const row = await storefront(t.storeA1)
    const repo = row?.repo ?? ''
    expect(row).toMatchObject({ repo_state: 'ready', template: 'bloom', repo_head: github.repos.get(repo)?.main })
    // The id a build's OIDC token names (#517).
    expect(row?.repo_id).toBe(String(github.repos.get(repo)?.id))
    expect(github.repos.get(repo)?.private).toBe(false)
    expect(github.history(repo).map((c) => c.message)).toEqual([`Store settings and storefront-core ${core}`, 'Start from the bloom template', 'Initial commit'])

    const files = github.files(repo)
    expect([...(files?.keys() ?? [])].sort()).toEqual(['.env.development', '.github/workflows/build.yml', '.npmrc', 'content/en/home.json', 'next.config.ts', 'package.json', 'routes.json', 'src/app/layout.tsx', 'src/theme/pages/HomePage.tsx', 'store.config.ts'])
    expect(files?.get('.github/workflows/build.yml')).toBe(lockedWorkflow)
    expect(lockedWorkflow).toMatch(/on:\n {2}workflow_dispatch:/)
    expect(JSON.parse(files?.get('package.json') ?? '{}')).toEqual({ name: repo, private: true, dependencies: { '@dripfunnel/storefront-core': core, next: '^16.3.6' } })
    expect(files?.get('store.config.ts')).toContain(`publicStoreKey: '${row?.public_store_key ?? ''}'`)
    const [named] = await db.sql<{ slug: string }[]>`select slug from store where id = ${t.storeA1}`
    expect(files?.get('.env.development')).toBe(`SHOP_API_PROXY=https://${named?.slug ?? ''}.my-store.one\n`)
    // No secret or variable, and an .npmrc with no token: nothing but the repo, Actions' settings and git data was ever asked for.
    expect(files?.get('.npmrc')).toBe(npmrc)
    expect(npmrc).not.toMatch(/_auth|token/i)
    expect(github.calls.filter((c) => /secrets|variables|environments|keys|collaborators/.test(c))).toEqual([])
    expect(github.repos.get(repo)?.settings['/actions/permissions/fork-pr-contributor-approval']).toEqual({ approval_policy: 'all_external_contributors' })
    expect(github.repos.get(repo)?.settings['/actions/permissions/workflow']).toEqual({ default_workflow_permissions: 'read', can_approve_pull_request_reviews: false })

    const [draft] = await db.sql<{ head_commit: string; template: string; core_version: string; preview_deploy_ref: string }[]>`select head_commit, template, core_version, preview_deploy_ref from design_draft where store_id = ${t.storeA1}`
    expect(draft).toEqual({ head_commit: row?.repo_head, template: 'bloom', core_version: core, preview_deploy_ref: params.jobId })
    const folder = `stores/${t.storeA1}/preview/${params.jobId}/`
    expect(sites.keys(folder)).toEqual([`${folder}assets/app.js`, `${folder}index.html`])
    expect(new TextDecoder().decode(sites.objects.get(`${folder}index.html`)?.bytes)).toBe(preview['index.html'])
    expect(sites.objects.get(`${folder}index.html`)?.contentType).toBe('text/html')

    expect(await job(params.jobId)).toMatchObject({ state: 'done', step: 'done' })
    const [store] = await db.sql<{ core_version: string }[]>`select core_version from store where id = ${t.storeA1}`
    expect(store?.core_version).toBe(core)
    const [entry] = await db.sql<{ action: string; actor_kind: string; target_label: string }[]>`select action, actor_kind, target_label from activity_log where store_id = ${t.storeA1} and action like 'storefront.%'`
    expect(entry).toEqual({ action: 'storefront.created', actor_kind: 'job', target_label: repo })
  })

  it('writes no .env.development where SHOP_DOMAIN isn’t set, so a clone’s next dev proxies nothing', async () => {
    const params = await started(t.storeA1)
    expect(await runCreateStorefront({ ...deps, shopDomain: null }, params, once)).toBe('created')
    const files = github.files((await storefront(t.storeA1))?.repo ?? '')
    expect(files?.has('.env.development')).toBe(false)
    expect(files?.has('store.config.ts')).toBe(true)
  })

  it('creates a store on a dev prerelease of core', async () => {
    const dev = '0.0.0-dev.7'
    await uploadTemplates(dev)
    const params = await started(t.storeA1)
    expect(await runCreateStorefront(deps, params, once)).toBe('created')
    const [draft] = await db.sql<{ core_version: string }[]>`select core_version from design_draft where store_id = ${t.storeA1}`
    expect(draft?.core_version).toBe(dev)
  })

  it('reuses the repo and its commits when a step is retried after it acted', async () => {
    const params = await started(t.storeA1)
    const failed = new Set<ProvisioningStep>()
    const failOnce = (step: ProvisioningStep) => {
      if (failed.has(step)) return
      failed.add(step)
      throw new Error(`injected at ${step}`)
    }
    expect(await runCreateStorefront({ ...deps, failAt: failOnce }, params, retrying)).toBe('created')
    expect(failed).toEqual(new Set(steps))
    const repo = (await storefront(t.storeA1))?.repo ?? ''
    expect(github.repos.size).toBe(1)
    expect(github.history(repo)).toHaveLength(3)
    // The retried create found the repo it had made rather than a second one.
    expect(github.calls.filter((c) => c === 'POST /orgs/dripfunnel/repos')).toHaveLength(2)
    expect(sites.keys(`stores/${t.storeA1}/`)).toHaveLength(2)
  })

  it('stops, undoing nothing, when its job is no longer running', async () => {
    const params = await started(t.storeA1)
    expect(await runCreateStorefront(deps, params, once)).toBe('created')
    const calls = github.calls.length
    expect(await runCreateStorefront(deps, params, once)).toBe('stopped')
    expect(github.calls).toHaveLength(calls)
    expect(await storefront(t.storeA1)).toMatchObject({ repo_state: 'ready' })
    expect(await job(params.jobId)).toMatchObject({ state: 'done' })
  })

  it('keeps the name of a store left creating with no job, so the next run reuses its repo', async () => {
    const params = await started(t.storeA1)
    const failAt = (step: ProvisioningStep) => {
      if (step === 'repo') throw new Error('injected')
    }
    const undoFails: StepRunner = { do: async (name, work) => (name === 'undo' ? Promise.reject(new Error('GitHub down while undoing')) : work()) }
    await expect(runCreateStorefront({ ...deps, failAt }, params, undoFails)).rejects.toThrow(/undoing/)
    const left = (await storefront(t.storeA1))?.repo ?? ''
    expect(github.repos.has(left)).toBe(true)
    await db.sql`update job set state = 'failed' where id = ${params.jobId}`
    const again = await started(t.storeA1)
    expect((await storefront(t.storeA1))?.repo).toBe(left)
    expect(await runCreateStorefront(deps, again, once)).toBe('created')
    expect(github.repos.size).toBe(1)
  })

  it('retries a GitHub outage and carries on', async () => {
    const params = await started(t.storeA1)
    github.fail(/^POST \/orgs\/dripfunnel\/repos$/, 503, 2)
    github.fail(/\/git\/commits$/, 502, 1)
    expect(await runCreateStorefront(deps, params, once)).toBe('created')
    expect((await storefront(t.storeA1))?.repo_state).toBe('ready')
  })

  it.each(steps)('leaves nothing behind when %s fails for good, and the store can try again', async (failing) => {
    const params = await started(t.storeA1)
    const failAt = (step: ProvisioningStep) => {
      if (step === failing) throw new Error(`injected at ${step}`)
    }
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => void lines.push(String(line)))
    try {
      expect(await runCreateStorefront({ ...deps, failAt }, params, once)).toBe('undone')
    } finally {
      spy.mockRestore()
    }
    expect(github.repos.size).toBe(0)
    expect(sites.keys('stores/')).toEqual([])
    expect(await db.sql`select 1 from design_draft`).toHaveLength(0)
    expect(await db.sql`select 1 from storefront_push`).toHaveLength(0)
    expect(await storefront(t.storeA1)).toMatchObject({ repo: null, repo_id: null, repo_head: null, repo_state: 'failed', template: null })
    expect(await job(params.jobId)).toMatchObject({ state: 'failed', last_error: createFailedMessage })
    // Staff see where and how it stopped, as a code, never the error's words.
    const [detail] = await db.sql<{ details: string }[]>`select details from job_detail where job_id = ${params.jobId}`
    expect(detail?.details).toBe(`Stopped at ${failing}: Error`)
    expect(lines).toContainEqual(expect.stringContaining(`"event":"storefront_create_failed","api":"system","storeId":"${t.storeA1}","code":"${failing}:Error"`))
    const [store] = await db.sql<{ core_version: string | null }[]>`select core_version from store where id = ${t.storeA1}`
    expect(store?.core_version).toBeNull()
    expect((await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1} and action like 'storefront.%' order by occurred_at desc limit 1`)[0]?.action).toBe('storefront.create_failed')

    const again = await started(t.storeA1)
    expect(again.jobId).not.toBe(params.jobId)
    expect(await runCreateStorefront(deps, again, once)).toBe('created')
    expect(github.repos.size).toBe(1)
    await db.sql`delete from activity_log where store_id = ${t.storeA1}`
  })

  it('undoes everything when the template or its preview is missing, or a copy isn’t confirmed', async () => {
    const missing = await started(t.storeA1, 'atelier')
    expect(await runCreateStorefront(deps, missing, once)).toBe('undone')
    expect(github.repos.size).toBe(0)

    const unconfirmed = await started(t.storeA1)
    sites.unconfirmed(`stores/${t.storeA1}/preview/`)
    expect(await runCreateStorefront(deps, unconfirmed, once)).toBe('undone')
    expect(github.repos.size).toBe(0)
    expect(sites.keys('stores/')).toEqual([])
  })

  it('never touches another store’s repo', async () => {
    const other = await started(t.storeA2)
    await runCreateStorefront(deps, other, once)
    const otherRepo = (await storefront(t.storeA2))?.repo ?? ''
    const otherMain = github.repos.get(otherRepo)?.main
    github.calls.length = 0
    const failAt = (step: ProvisioningStep) => {
      if (step === 'firstBuild') throw new Error('injected')
    }
    expect(await runCreateStorefront({ ...deps, failAt }, await started(t.storeA1), once)).toBe('undone')
    expect(github.calls.filter((c) => c.includes(otherRepo))).toEqual([])
    expect(github.repos.get(otherRepo)?.main).toBe(otherMain)
    expect(sites.keys(`stores/${t.storeA2}/`)).toHaveLength(2)
    expect(await storefront(t.storeA2)).toMatchObject({ repo_state: 'ready' })
  })

  it('shows a store’s draft to its own merchant only: never another store, a supplier or a partner', async () => {
    await runCreateStorefront(deps, await started(t.storeA1), once)
    const person = { kind: 'person' as const, userId: '00000000-0000-4000-8000-0000000000aa', sessionId: 's' }
    const read = (context: CallerContext) => withScope(db.sql, context, (tx) => tx<{ store_id: string }[]>`select store_id from design_draft`)
    expect(await read({ caller: person, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' })).toEqual([{ store_id: t.storeA1 }])
    expect(await read({ caller: person, partnerId: t.partnerA, storeId: t.storeA2, sellerScope: { kind: 'all' }, subscription: 'active' })).toEqual([])
    await expect(read({ caller: person, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'seller', sellerId: t.sellerA1First }, subscription: 'active' })).rejects.toThrow(/permission denied/i)
    await expect(read({ caller: { kind: 'partner-user', partnerUserId: '00000000-0000-4000-8000-0000000000bb' }, partnerId: t.partnerA })).rejects.toThrow(/permission denied/i)
  })

  it('keeps no token or key in any row or log line', async () => {
    const lines: string[] = []
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
    const spies = [vi.spyOn(console, 'log').mockImplementation(capture), vi.spyOn(console, 'error').mockImplementation(capture), vi.spyOn(console, 'warn').mockImplementation(capture)]
    try {
      const failAt = (step: ProvisioningStep) => {
        if (step === 'done') throw new Error('injected')
      }
      await runCreateStorefront({ ...deps, failAt }, await started(t.storeA1), once)
      await runCreateStorefront(deps, await started(t.storeA1), once)
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
    const rows = await Promise.all([
      db.sql`select * from job`,
      db.sql`select * from job_detail`,
      db.sql`select * from outbox`,
      db.sql`select * from activity_log`,
      db.sql`select * from storefront`,
      db.sql`select * from storefront_push`,
      db.sql`select * from design_draft`,
    ])
    expect(JSON.stringify([rows, lines])).not.toMatch(/ghs_|Bearer|PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\./)
  })
})
