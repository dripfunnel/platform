import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TenantContext } from '#core/tenancy'
import type { StoreRole } from '#auth/storePermissions'
import { draftBundle, previewFolder, type SitesBucket } from '#saas/storefronts/index'
import { liveStudioSession, openStudioSession, renewStudio, studioOf, StudioRunner, StudioUnavailable, type DesignModel, type DraftsBucket, type Proposal, type StudioDeps } from '#saas/studio/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { sandboxProcess, type SandboxProcess } from './support/sandboxProcess'

// INF 3 (#482): the studio's change loop against the real sandbox (apps/sandbox in its own process, real git and the
// real fast gate) and the real database; R2 and the model are stand-ins (storefront AI-STUDIO.md §3–§8).
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 })

const core = '0.4.0'
const baselineDir = fileURLToPath(new URL('../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))

const walk = async (dir: string, prefix = ''): Promise<{ path: string; content: string }[]> =>
  (
    await Promise.all(
      (await readdir(join(dir, prefix))).map(async (name) => {
        const rel = prefix ? `${prefix}/${name}` : name
        return (await stat(join(dir, rel))).isDirectory() ? walk(dir, rel) : [{ path: rel, content: await readFile(join(dir, rel), 'utf8') }]
      }),
    )
  ).flat()

const memoryBucket = () => {
  const objects = new Map<string, { bytes: ArrayBuffer; type?: string | undefined }>()
  const puts: string[] = []
  const bucket: SitesBucket & DraftsBucket = {
    get: async (key: string) => {
      const o = objects.get(key)
      return o ? { text: async () => new TextDecoder().decode(o.bytes), arrayBuffer: async () => o.bytes, httpMetadata: { ...(o.type ? { contentType: o.type } : {}) } } : null
    },
    put: async (key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
      puts.push(key)
      objects.set(key, { bytes: value, type: options?.httpMetadata?.contentType })
      return { checksums: {} }
    },
    list: async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    delete: async (keys: string[]) => {
      for (const k of keys) objects.delete(k)
    },
  }
  return { bucket, objects, puts }
}

let db: TestDatabase
let t: Tenants
let template: { path: string; content: string }[]
const processes: SandboxProcess[] = []

const enPages = () => template.find((f) => f.path === 'content/en/pages.json')?.content ?? ''
const lead = (words: string) => ({ path: 'content/en/pages.json', content: enPages().replace(/"lead": "[^"]*"/, `"lead": "${words}"`) })
const refusedPage = { path: 'src/theme/pages/HomePage.tsx', content: "export const HomePage = () => { fetch('/x'); return null }\n" }

/** A model that answers from a script, one answer per ask, and records what it was asked. */
const scripted = (answers: Proposal['files'][], gate?: Promise<void>) => {
  const asks: { problems: number }[] = []
  const model: DesignModel = {
    propose: async (input) => {
      asks.push({ problems: input.problems.length })
      await gate
      const files = answers[Math.min(asks.length - 1, answers.length - 1)] ?? []
      return { files, model: 'test-model', tokensIn: 120, tokensOut: 80, costAmount: 3, costCurrency: 'USD' }
    },
  }
  return { model, asks }
}

const seedUser = async (storeId: string, partnerId: string, role: string, email: string) => {
  const [user] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, 'Studio', 'active') returning id`
  const userId = user?.id ?? ''
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${userId}, ${storeId}, ${role}, 'active')`
  const sessionHash = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await db.sql`insert into user_session (id_hash, user_id, partner_id, absolute_expires_at) values (${sessionHash}, ${userId}, ${partnerId}, now() + interval '1 day')`
  return { userId, sessionHash }
}

const contextFor = (storeId: string, partnerId: string, userId: string, sessionId: string): TenantContext => ({
  caller: { kind: 'person', userId, sessionId },
  partnerId,
  storeId,
  sellerScope: { kind: 'all' },
  subscription: 'active',
})

const owner: StoreRole = { side: 'merchant', role: 'owner' }
const manager: StoreRole = { side: 'merchant', role: 'manager' }
const staff: StoreRole = { side: 'merchant', role: 'staff' }
const supplier: StoreRole = { side: 'supplier', role: 'supplier-admin', tier: 'vendor-catalogue' }

let sites: ReturnType<typeof memoryBucket>
let drafts: ReturnType<typeof memoryBucket>
let ownerA: { userId: string; sessionHash: string }

const runnerFor = async (storeId: string, overrides: Partial<StudioDeps> = {}) => {
  const host = await sandboxProcess()
  processes.push(host)
  const released: string[] = []
  const bundles: string[] = []
  const runner = new StudioRunner({
    db: (work) => work(db.sql),
    storeId,
    host: async () => host,
    drafts: drafts.bucket,
    sites: sites.bucket,
    capacity: { acquire: async () => ({ granted: true }), release: async () => void released.push(storeId) },
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    onBundle: (b) => void bundles.push(b.id),
    ...overrides,
  })
  return { runner, host, bundles, released }
}

const draftRow = async (storeId: string) => (await db.sql<{ head_commit: string; preview_deploy_ref: string | null; changed_by: string | null }[]>`select head_commit, preview_deploy_ref, changed_by from design_draft where store_id = ${storeId}`)[0] ?? null

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  template = await walk(baselineDir)
  for (const storeId of [t.storeA1, t.storeA2, t.storeB1]) {
    await db.sql`update store set core_version = ${core} where id = ${storeId}`
    await db.sql`update storefront set template = 'baseline', repo_state = 'ready', repo = ${`sf-${storeId.replaceAll('-', '').slice(0, 10)}`} where store_id = ${storeId}`
    await db.sql`insert into store_language (store_id, language) values (${storeId}, 'en-IN'), (${storeId}, 'hi-IN') on conflict do nothing`
    await db.sql`update store set main_language = 'en-IN' where id = ${storeId}`
  }
  ownerA = await seedUser(t.storeA1, t.partnerA, 'owner', 'owner.a1@studio.example')
})

beforeEach(async () => {
  sites = memoryBucket()
  drafts = memoryBucket()
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
  await sites.bucket.put(`templates/${core}/skeleton.json`, json({ files: [{ path: 'package.json', content: '{"name":"store"}\n' }, { path: '.github/workflows/build.yml', content: 'on: workflow_dispatch\n' }] }))
  await sites.bucket.put(`templates/${core}/themes/baseline/source.json`, json({ files: template }))
  sites.puts.length = 0
  await db.sql`delete from ai_run`
  await db.sql`delete from design_draft`
})

afterAll(async () => {
  for (const p of processes) await p.close()
  await db.drop()
})

describe('one change', () => {
  it('becomes a local commit, saved as the draft bundle, written as the new preview, and undo reverts it', async () => {
    const { runner, bundles } = await runnerFor(t.storeA1)
    const { model } = scripted([[lead('Linen made slowly, for warm days.')]])
    const changed = await runner.change({ request: 'Make the lead warmer', userId: ownerA.userId, billedTo: 'plan', model })
    expect(changed).toMatchObject({ outcome: 'changed', repairs: 0 })
    if (changed.outcome !== 'changed') return
    expect(drafts.objects.has(draftBundle(t.storeA1))).toBe(true)
    expect(sites.objects.has(`${previewFolder(t.storeA1, changed.previewRef)}index.html`)).toBe(true)
    expect([...sites.objects.keys()].some((k) => k.startsWith(previewFolder(t.storeA1, changed.previewRef)) && k.includes('assets/core/'))).toBe(false)
    expect(await draftRow(t.storeA1)).toEqual({ head_commit: changed.commit, preview_deploy_ref: changed.previewRef, changed_by: ownerA.userId })
    expect(bundles.length).toBeGreaterThanOrEqual(2)

    const undone = await runner.undo(changed.commit, ownerA.userId)
    expect(undone).toMatchObject({ outcome: 'changed' })
    if (undone.outcome !== 'changed') return
    expect((await draftRow(t.storeA1))?.head_commit).toBe(undone.commit)
    expect(undone.previewRef).not.toBe(changed.previewRef)
    const [run] = await db.sql<{ kind: string; billed_to: string; sandbox_ms: number; outcome: string }[]>`select kind, billed_to, sandbox_ms, outcome from ai_run where store_id = ${t.storeA1}`
    expect(run).toMatchObject({ kind: 'design', billed_to: 'plan', outcome: 'changed' })
    expect(run?.sandbox_ms).toBeGreaterThan(0)
  })

  it('is refused after three repairs with nothing changed, and records the three repairs on the platform', async () => {
    const { runner } = await runnerFor(t.storeA2)
    await runner.open()
    const before = { drafts: drafts.puts.length, sites: sites.puts.length }
    const { model, asks } = scripted([[refusedPage]])
    const refused = await runner.change({ request: 'Fetch something', userId: ownerA.userId, billedTo: 'own_key', model })
    expect(refused).toMatchObject({ outcome: 'refused', repairs: 3 })
    expect(asks).toEqual([{ problems: 0 }, { problems: 1 }, { problems: 1 }, { problems: 1 }])
    expect({ drafts: drafts.puts.length, sites: sites.puts.length }).toEqual(before)
    expect(await draftRow(t.storeA2)).toBeNull()
    const runs = await db.sql<{ kind: string; billed_to: string; parent_run_id: string | null; outcome: string; repair_attempts: number }[]>`
      select kind, billed_to, parent_run_id, outcome, repair_attempts from ai_run where store_id = ${t.storeA2} order by kind, created_at`
    expect(runs.map((r) => [r.kind, r.billed_to, r.outcome])).toEqual([
      ['design', 'own_key', 'refused'],
      ['repair', 'platform', 'refused'],
      ['repair', 'platform', 'refused'],
      ['repair', 'platform', 'refused'],
    ])
    expect(runs[0]?.repair_attempts).toBe(3)
    expect(new Set(runs.slice(1).map((r) => r.parent_run_id))).toEqual(new Set([refused.runId]))
  })

  it('takes a repair that passes the gate', async () => {
    const { runner } = await runnerFor(t.storeA2)
    const { model } = scripted([[refusedPage], [lead('Repaired on the second try.')]])
    expect(await runner.change({ request: 'A change needing one repair', userId: ownerA.userId, billedTo: 'plan', model })).toMatchObject({ outcome: 'changed', repairs: 1 })
    const runs = await db.sql<{ kind: string; outcome: string }[]>`select kind, outcome from ai_run where store_id = ${t.storeA2} order by kind`
    expect(runs).toEqual([
      { kind: 'design', outcome: 'changed' },
      { kind: 'repair', outcome: 'changed' },
    ])
  })
})

describe('one change at a time', () => {
  it('runs two requests for one store one after the other, and two stores side by side', async () => {
    let releaseA: () => void = () => undefined
    const gateA = new Promise<void>((resolve) => (releaseA = resolve))
    const a = await runnerFor(t.storeA1)
    const b = await runnerFor(t.storeB1)
    const first = scripted([[lead('First of two.')]], gateA)
    const second = scripted([[lead('Second of two.')]])
    const one = a.runner.change({ request: 'First', userId: ownerA.userId, billedTo: 'plan', model: first.model })
    const two = a.runner.change({ request: 'Second', userId: ownerA.userId, billedTo: 'plan', model: second.model })
    const other = scripted([[lead('Another store.')]])
    // Store B finishes while store A's first change is still waiting on its model.
    expect(await b.runner.change({ request: 'Other store', userId: ownerA.userId, billedTo: 'plan', model: other.model })).toMatchObject({ outcome: 'changed' })
    await vi.waitFor(() => expect(first.asks).toHaveLength(1))
    expect(a.runner.pending).toBe(2)
    expect(second.asks).toHaveLength(0)
    releaseA()
    const [r1, r2] = await Promise.all([one, two])
    expect(r1).toMatchObject({ outcome: 'changed' })
    expect(r2).toMatchObject({ outcome: 'changed' })
    expect((await draftRow(t.storeA1))?.head_commit).toBe(r2.outcome === 'changed' ? r2.commit : '')
  })
})

describe('a crash mid-change', () => {
  it('restarts the sandbox from the saved draft and tries the change once more', async () => {
    const { runner, host } = await runnerFor(t.storeA1)
    const saved = await runner.change({ request: 'Saved first', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('Saved before the crash.')]]).model })
    expect(saved.outcome).toBe('changed')
    const savedHead = (await draftRow(t.storeA1))?.head_commit
    const crashing: DesignModel = {
      propose: async () => {
        if (host.starts() === 1) host.kill()
        return { files: [lead('After the restart.')], model: 'test-model', tokensIn: 1, tokensOut: 1, costAmount: 0, costCurrency: 'USD' }
      },
    }
    const retried = await runner.change({ request: 'Crashes once', userId: ownerA.userId, billedTo: 'plan', model: crashing })
    expect(host.starts()).toBe(2)
    expect(retried).toMatchObject({ outcome: 'changed' })
    expect((await draftRow(t.storeA1))?.head_commit).not.toBe(savedHead)
  })

  it('leaves the draft at the last saved state when the sandbox dies twice', async () => {
    const { runner, host } = await runnerFor(t.storeA1)
    await runner.change({ request: 'Saved first', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('The last saved state.')]]).model })
    const savedHead = (await draftRow(t.storeA1))?.head_commit
    const savedBundle = drafts.objects.get(draftBundle(t.storeA1))?.bytes
    const dying = scripted([[lead('Never saved.')]]).model
    // The container dies whenever a change reaches it, so the retry after the restart dies too.
    const killOnChange = { ...host, send: async (request: Request) => (request.url.endsWith('/changes') ? (host.kill(), host.send(request)) : host.send(request)) }
    const fragile = new StudioRunner({
      db: (work) => work(db.sql),
      storeId: t.storeA1,
      host: async () => killOnChange,
      drafts: drafts.bucket,
      sites: sites.bucket,
      capacity: { acquire: async () => ({ granted: true }), release: async () => undefined },
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
      onBundle: () => undefined,
    })
    await expect(fragile.change({ request: 'Dies twice', userId: ownerA.userId, billedTo: 'plan', model: dying })).rejects.toBeInstanceOf(StudioUnavailable)
    expect((await draftRow(t.storeA1))?.head_commit).toBe(savedHead)
    expect(drafts.objects.get(draftBundle(t.storeA1))?.bytes).toBe(savedBundle)
  })
})

describe('GitHub', () => {
  it('gets nothing from the studio: the repo’s head and pushes stay as they were', async () => {
    const [before] = await db.sql<{ repo_head: string | null }[]>`select repo_head from storefront where store_id = ${t.storeA1}`
    const { runner } = await runnerFor(t.storeA1)
    await runner.change({ request: 'A private change', userId: ownerA.userId, billedTo: 'plan', model: scripted([[lead('Private until published.')]]).model })
    const [after] = await db.sql<{ repo_head: string | null }[]>`select repo_head from storefront where store_id = ${t.storeA1}`
    expect(after?.repo_head).toBe(before?.repo_head)
    expect(await db.sql`select 1 from storefront_push where store_id = ${t.storeA1}`).toHaveLength(0)
  })
})

describe('studio sessions (AI-STUDIO §8)', () => {
  it('lets the Owner change and a Manager view, and opens nothing for staff or a supplier', async () => {
    const now = new Date()
    const ctx = contextFor(t.storeA1, t.partnerA, ownerA.userId, ownerA.sessionHash)
    expect((await openStudioSession(db.sql, ctx, owner, now))?.access).toBe('change')
    expect((await openStudioSession(db.sql, ctx, manager, now))?.access).toBe('view')
    expect(await openStudioSession(db.sql, ctx, staff, now)).toBeNull()
    expect(await openStudioSession(db.sql, { ...ctx, sellerScope: { kind: 'seller', sellerId: t.sellerA1First } }, supplier, now)).toBeNull()
    expect(await openStudioSession(db.sql, { ...ctx, caller: { kind: 'support', supportSessionId: 's', partnerUserId: 'p', access: 'read' } }, owner, now)).toBeNull()
  })

  it('is bound to its store, kept only as a hash, and ends with its portal session or its time', async () => {
    const now = new Date()
    const user = await seedUser(t.storeA1, t.partnerA, 'owner', 'bound.a1@studio.example')
    const opened = await openStudioSession(db.sql, contextFor(t.storeA1, t.partnerA, user.userId, user.sessionHash), owner, now)
    const id = opened?.id ?? ''
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(await db.sql`select 1 from studio_session where id_hash = ${id}`).toHaveLength(0)
    expect(await liveStudioSession(db.sql, t.storeA1, id, now)).toEqual({ userId: user.userId, access: 'change' })
    // Store B's host, or any other store's, gets nothing for A's id.
    expect(await liveStudioSession(db.sql, t.storeB1, id, now)).toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA2, id, now)).toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA1, id, new Date(now.getTime() + 5 * 60 * 1000 + 1))).toBeNull()
    await db.sql`delete from user_session where id_hash = ${user.sessionHash}`
    expect(await liveStudioSession(db.sql, t.storeA1, id, now)).toBeNull()
  })

  it('renews only with access still held, for the same user and portal session', async () => {
    const now = new Date()
    const user = await seedUser(t.storeA1, t.partnerA, 'owner', 'renew.a1@studio.example')
    const ctx = contextFor(t.storeA1, t.partnerA, user.userId, user.sessionHash)
    const id = (await openStudioSession(db.sql, ctx, owner, now))?.id ?? ''
    const later = new Date(now.getTime() + 4 * 60 * 1000)
    expect((await renewStudio(db.sql, ctx, owner, id, later))?.getTime()).toBe(later.getTime() + 5 * 60 * 1000)
    expect(await renewStudio(db.sql, { ...ctx, caller: { kind: 'person', userId: user.userId, sessionId: ownerA.sessionHash } }, owner, id, later)).toBeNull()
    expect(await renewStudio(db.sql, { ...ctx, storeId: t.storeA2 }, owner, id, later)).toBeNull()
    expect(await renewStudio(db.sql, ctx, manager, id, later)).not.toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA1, id, later)).toMatchObject({ access: 'view' })
    // A seat taken away gets no renewal, and its session ends at once.
    expect(await renewStudio(db.sql, ctx, staff, id, later)).toBeNull()
    expect(await liveStudioSession(db.sql, t.storeA1, id, later)).toBeNull()
  })

  it('picks the store’s Durable Object from the TenantContext, never from anything the caller sent', () => {
    const named: string[] = []
    const namespace = { idFromName: (name: string) => (named.push(name), name), get: (id: string) => ({ id }) } as unknown as DurableObjectNamespace
    expect(studioOf(namespace, contextFor(t.storeA1, t.partnerA, ownerA.userId, ownerA.sessionHash))).toEqual({ id: t.storeA1 })
    expect(named).toEqual([t.storeA1])
  })
})
