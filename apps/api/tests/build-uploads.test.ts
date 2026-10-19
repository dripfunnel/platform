import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { actionsIssuer, actionsKeys } from '#integrations/github/oidc'
import { storefrontR2 } from '#integrations/cloudflare/r2'
import { localActions } from '#integrations/local/builds'
import { advisoryChecks, BuildRefused, BuildUnavailable, buildLifetimeMs, digestOf, issueCredentials, reportBuild, reportUploaded, runPublish, startBuild, UploadRefused, verifyUpload, type BuildDeps, type GateReport } from '#saas/storefronts/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { testProbe } from './support/edgeProbe'
import { fakeSites, putText, type FakeSites } from './support/sites'

// INF 2b (#517) part 1: a store build's calls (storefront LIVE-SHOP.md §4 steps 5–8, §9) against the real database, fake
// GitHub keys and a fake Cloudflare API. Every refusal is the same refusal; every handout names this build alone.

let db: TestDatabase
let t: Tenants
let sites: FakeSites
let signer: { kid: string; privateKey: CryptoKey; jwk: JWK }
let stranger: CryptoKey
const now = new Date('2026-10-11T10:00:00Z')
const audience = 'https://hooks.dripfunnel.com'
const parent = { accountId: 'a'.repeat(32), accessKeyId: 'b'.repeat(32), secretAccessKey: 'c'.repeat(64), apiToken: 'parent-api-token-value-0123456789' }
const minted: { body: Record<string, unknown> }[] = []
const temporary = { accessKeyId: 'tmp-access-key-id-1', secretAccessKey: 'tmp-secret-access-key-1', sessionToken: 'tmp-session-token-1' }
const repos = { a1: { repo: 'sf-aaaaaaaaa1', id: 1001 }, a2: { repo: 'sf-aaaaaaaaa2', id: 1002 } }

const fakeGitHub = (async () => Response.json({ keys: [signer.jwk] })) as unknown as typeof fetch
const fakeCloudflare = (async (_: RequestInfo | URL, init?: RequestInit) => {
  minted.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> })
  return Response.json({ success: true, errors: [], result: temporary })
}) as typeof fetch

let deps: BuildDeps
let assets: FakeSites
const woken: string[] = []

const claimsFor = (repo: { repo: string; id: number }, runId = '5001') => ({
  repository: `dripfunnel/${repo.repo}`,
  repository_id: String(repo.id),
  job_workflow_ref: `dripfunnel/${repo.repo}/.github/workflows/build.yml@refs/heads/main`,
  ref: 'refs/heads/main',
  event_name: 'workflow_dispatch',
  run_id: runId,
})

const token = (claims: Record<string, unknown>, o: { exp?: number; key?: CryptoKey } = {}) => {
  const at = Math.floor(now.getTime() / 1000)
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: signer.kid })
    .setIssuer(actionsIssuer)
    .setAudience(audience)
    .setIssuedAt(at - 30)
    .setExpirationTime(o.exp ?? at + 270)
    .sign(o.key ?? signer.privateKey)
}

/** One build runs at a time per store (SAAS §9.1), so the store's last one is ended first. */
const newBuild = async (storeId: string, o: { startedAt?: Date | null; state?: string } = {}) => {
  await db.sql`update publish_run set state = 'failed', finished_at = now() where store_id = ${storeId} and state in ('queued', 'building', 'checking', 'deploying')`
  const [row] = await db.sql<{ id: string }[]>`
    insert into publish_run (store_id, kind, state, commit, template, core_version, started_by_kind, started_at)
    values (${storeId}, 'manual', ${o.state ?? 'building'}, ${'a'.repeat(40)}, 'bloom', '1.4.0', 'system',
      ${o.startedAt === undefined ? new Date(now.getTime() - 5 * 60_000) : o.startedAt})
    returning id`
  return row?.id ?? ''
}

const run = (buildId: string) => db.sql<{ state: string; github_run_id: string | null; gate: unknown; gate_digest: string | null; error: string | null }[]>`
  select state, github_run_id::text as github_run_id, gate, gate_digest, error from publish_run where id = ${buildId}`.then((r) => r[0])

const refusal = (work: Promise<unknown>) =>
  work.then(
    () => 'accepted',
    (error: unknown) => (error instanceof BuildRefused ? error.reason : String(error)),
  )

const report = (build: string, passed = true): GateReport => ({
  build,
  passed,
  digest: 'd'.repeat(64),
  checks: [
    { name: 'contract', passed: true },
    { name: 'axe', passed, ...(passed ? {} : { detail: 'Two images have no text alternative.' }) },
  ],
})

/** A build whose run has passed its checks, ready for credentials. */
const passedBuild = async (storeId: string, repo: { repo: string; id: number }, runId: string) => {
  const id = await newBuild(storeId)
  const auth = await token(claimsFor(repo, runId))
  await startBuild(deps, auth, id)
  await reportBuild(deps, auth, report(id))
  return { id, auth }
}


beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  const pair = await generateKeyPair('RS256', { extractable: true })
  signer = { kid: 'gh-1', privateKey: pair.privateKey, jwk: { ...(await exportJWK(pair.publicKey)), kid: 'gh-1', alg: 'RS256', use: 'sig' } }
  stranger = (await generateKeyPair('RS256', { extractable: true })).privateKey
  for (const [storeId, repo] of [
    [t.storeA1, repos.a1],
    [t.storeA2, repos.a2],
  ] as const) {
    await db.sql`update storefront set repo = ${repo.repo}, repo_id = ${repo.id}, repo_state = 'ready' where store_id = ${storeId}`
  }
  sites = fakeSites()
  assets = fakeSites()
  deps = { sql: db.sql, keys: actionsKeys(fakeGitHub), audience, org: 'dripfunnel', r2: storefrontR2(parent, fakeCloudflare), buckets: { sites: 'storefront-sites', drafts: 'storefront-drafts' }, sites, wake: async (id, event) => void woken.push(`${id}:${event}`), now: () => now }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the OIDC check on every call', () => {
  it('starts the store’s own run: links to its own build’s input for 15 minutes, and the build bound to that run', async () => {
    const id = await newBuild(t.storeA1)
    const answer = await startBuild(deps, await token(claimsFor(repos.a1, '5001')), id)
    const source = new URL(answer.source)
    expect(source.pathname).toBe(`/storefront-drafts/sources/${t.storeA1}/${id}.bundle`)
    expect(source.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(new URL(answer.snapshot).pathname).toBe(`/storefront-drafts/snapshots/${t.storeA1}/${id}.json`)
    expect(answer.live).toBeNull()
    // The commit and the build image the workflow needs (#483); a manual publish may change the look.
    expect([answer.commit, answer.core, answer.strictLook]).toEqual(['a'.repeat(40), '1.4.0', false])
    expect(answer.expiresAt).toBe('2026-10-11T10:15:00.000Z')
    expect((await run(id))?.github_run_id).toBe('5001')
  })

  it('links every file of the live build for the visual diff', async () => {
    const live = await newBuild(t.storeA2, { state: 'live' })
    await db.sql`update storefront set live_build_id = ${live} where store_id = ${t.storeA2}`
    const files = [{ path: 'index.html', sha256: 'e'.repeat(64), size: 10 }, { path: 'assets/app.js', sha256: 'f'.repeat(64), size: 5 }]
    await putText(sites, `stores/${t.storeA2}/builds/${live}/_manifest.json`, JSON.stringify({ files }))
    const id = await newBuild(t.storeA2)
    const answer = await startBuild(deps, await token(claimsFor(repos.a2, '6001')), id)
    expect(answer.live?.map((f) => [f.path, new URL(f.url).pathname])).toEqual([
      ['index.html', `/storefront-sites/stores/${t.storeA2}/builds/${live}/index.html`],
      ['assets/app.js', `/storefront-sites/stores/${t.storeA2}/builds/${live}/assets/app.js`],
    ])
    await db.sql`update storefront set live_build_id = null where store_id = ${t.storeA2}`
  })

  it('says it is unavailable, never refused or a 500, when the live build’s manifest can’t be read', async () => {
    const live = await newBuild(t.storeA2, { state: 'live' })
    await db.sql`update storefront set live_build_id = ${live} where store_id = ${t.storeA2}`
    await putText(sites, `stores/${t.storeA2}/builds/${live}/_manifest.json`, '{not json')
    const id = await newBuild(t.storeA2)
    expect(await startBuild(deps, await token(claimsFor(repos.a2, '6051')), id).catch((e: unknown) => e)).toBeInstanceOf(BuildUnavailable)
    await db.sql`update storefront set live_build_id = null where store_id = ${t.storeA2}`
  })

  it('refuses a token from another repo, another workflow file, another branch, a push and an expired one', async () => {
    const id = await newBuild(t.storeA1, { state: 'building' })
    const claims = claimsFor(repos.a1, '5101')
    const at = Math.floor(now.getTime() / 1000)
    const cases: [Record<string, unknown>, string, { exp?: number; key?: CryptoKey }?][] = [
      [{ ...claims, repository_id: '999999' }, 'wrong_repo'],
      [claimsFor(repos.a2, '5101'), 'wrong_repo'],
      [{ ...claims, job_workflow_ref: `dripfunnel/${repos.a1.repo}/.github/workflows/release.yml@refs/heads/main` }, 'wrong_workflow'],
      [{ ...claims, job_workflow_ref: `dripfunnel/${repos.a1.repo}/.github/workflows/build.yml@refs/heads/ai-draft`, ref: 'refs/heads/ai-draft' }, 'wrong_branch'],
      [{ ...claims, event_name: 'push' }, 'wrong_event'],
      [claims, 'bad_token', { exp: at - 60 }],
      [claims, 'bad_token', { key: stranger }],
    ]
    for (const [c, reason, o] of cases) expect(await refusal(startBuild(deps, await token(c, o), id))).toBe(reason)
    // None of them took the build: it is still free for its own run.
    expect((await run(id))?.github_run_id).toBeNull()
  })

  it('refuses a reused build id, an expired one, one never dispatched and one that doesn’t exist', async () => {
    const id = await newBuild(t.storeA1)
    await startBuild(deps, await token(claimsFor(repos.a1, '5201')), id)
    expect(await refusal(startBuild(deps, await token(claimsFor(repos.a1, '5202')), id))).toBe('other_run')
    const old = await newBuild(t.storeA1, { startedAt: new Date(now.getTime() - buildLifetimeMs - 1000), state: 'failed' })
    expect(await refusal(startBuild(deps, await token(claimsFor(repos.a1, '5203')), old))).toBe('expired_build')
    const queued = await newBuild(t.storeA2, { startedAt: null, state: 'queued' })
    expect(await refusal(startBuild(deps, await token(claimsFor(repos.a2, '5204')), queued))).toBe('expired_build')
    expect(await refusal(startBuild(deps, await token(claimsFor(repos.a1, '5205')), crypto.randomUUID()))).toBe('unknown_build')
  })

  it('records a refused run that proved itself on the store whose build it named, for staff only', async () => {
    const id = await newBuild(t.storeA2)
    await refusal(startBuild(deps, await token(claimsFor(repos.a1, '5301')), id))
    const [entry] = await db.sql<{ action: string; result: string; category: string; reason: string; visibility: string; store_id: string }[]>`
      select action, result, category, reason, visibility, store_id from activity_log where target_id = ${id}`
    expect(entry).toEqual({ action: 'storefront.build_refused', result: 'denied', category: 'security', reason: 'wrong_repo', visibility: 'staff', store_id: t.storeA2 })
  })
})

describe('the report', () => {
  it('is kept once on the build, from the verified run only, and a retry of it is answered the same', async () => {
    const id = await newBuild(t.storeA1)
    const auth = await token(claimsFor(repos.a1, '5401'))
    woken.length = 0
    expect(await reportBuild(deps, auth, report(id))).toEqual({ passed: true, upload: true })
    expect(await reportBuild(deps, auth, report(id))).toEqual({ passed: true, upload: true })
    // Each answer wakes the build's publish run, which reads the verdict from the row.
    expect(woken).toEqual([`${id}:reported`, `${id}:reported`])
    expect(await run(id)).toMatchObject({ state: 'deploying', github_run_id: '5401', gate_digest: 'd'.repeat(64), gate: { passed: true, checks: [{ name: 'contract', passed: true }, { name: 'axe', passed: true }] } })
    expect(await refusal(reportBuild(deps, auth, { ...report(id), digest: '0'.repeat(64) }))).toBe('wrong_state')
    expect(await refusal(reportBuild(deps, await token(claimsFor(repos.a1, '5402')), report(id)))).toBe('other_run')
  })

  it('is taken only from a run GitHub signed, never from a token anyone else made', async () => {
    const id = await newBuild(t.storeA1)
    expect(await refusal(reportBuild(deps, await token(claimsFor(repos.a1, '5451'), { key: stranger }), report(id)))).toBe('bad_token')
    expect(await run(id)).toMatchObject({ state: 'building', gate: null, github_run_id: null })
  })

  it('leaves a failing report to the publish run to decide (checking), naming the checks that failed', async () => {
    const id = await newBuild(t.storeA1)
    const auth = await token(claimsFor(repos.a1, '5501'))
    expect(await reportBuild(deps, auth, report(id, false))).toEqual({ passed: false, upload: false })
    expect(await run(id)).toMatchObject({ state: 'checking', error: null })
    const [entry] = await db.sql<{ action: string; reason: string }[]>`select action, reason from activity_log where target_id = ${id} and action like 'storefront.build_%ed'`
    expect(entry).toEqual({ action: 'storefront.build_failed', reason: 'axe' })
  })
})

describe('the verdict (#806)', () => {
  it('names the same advisory checks as storefront-core', () => {
    const core = readFileSync(new URL('../../../packages/storefront-core/src/guard/gate/report.ts', import.meta.url), 'utf8')
    const listed = /advisoryChecks: readonly GateCheckName\[\] = \[([^\]]*)\]/.exec(core)?.[1] ?? ''
    expect([...advisoryChecks]).toEqual(listed.split(',').map((n) => n.trim().replace(/'/g, '')))
  })
  const sent = (build: string, passed: boolean, checks: GateReport['checks']): GateReport => ({ build, passed, digest: 'd'.repeat(64), checks })
  it('follows the check names, not the runner’s passed: budgets, no-js, crawl and a free look only suggest', async () => {
    const id = await newBuild(t.storeA1)
    const auth = await token(claimsFor(repos.a1, '5601'))
    // An older image sends passed: false for a budget miss; the build still goes on to upload.
    expect(await reportBuild(deps, auth, sent(id, false, [{ name: 'axe', passed: true }, { name: 'budgets', passed: false, detail: 'Home page blocks for 290 ms while loading, over 150 ms.' }, { name: 'visual-diff', passed: false, detail: '1 page looks different from the live site.' }]))).toEqual({ passed: true, upload: true })
    expect(await run(id)).toMatchObject({ state: 'deploying', gate: { passed: true, checks: [{ name: 'axe' }, { name: 'budgets', passed: false }, { name: 'visual-diff', passed: false }] } })
    const [entry] = await db.sql<{ action: string; reason: string }[]>`select action, reason from activity_log where target_id = ${id} and action like 'storefront.build_%ed'`
    expect(entry).toEqual({ action: 'storefront.build_passed', reason: 'budgets, visual-diff' })
    // The same report again is answered as the first was.
    expect(await reportBuild(deps, auth, sent(id, false, [{ name: 'axe', passed: true }, { name: 'budgets', passed: false, detail: 'Home page blocks for 290 ms while loading, over 150 ms.' }, { name: 'visual-diff', passed: false, detail: '1 page looks different from the live site.' }]))).toEqual({ passed: true, upload: true })
  })
  it('still refuses a failing safety check, even when the runner says passed, and a check it has never heard of', async () => {
    for (const [n, failing] of [['axe', 'axe'], ['content', 'content'], ['sealed', 'sealed'], ['mystery', 'something-new']] as const) {
      const id = await newBuild(t.storeA1)
      const auth = await token(claimsFor(repos.a1, `57${n.length}${failing.length}`))
      expect(await reportBuild(deps, auth, sent(id, true, [{ name: failing, passed: false, detail: 'Broken.' }, { name: 'budgets', passed: true }]))).toEqual({ passed: false, upload: false })
      expect(await run(id)).toMatchObject({ state: 'checking', gate: { passed: false } })
    }
  })
  it('refuses a look that changed when the publish must keep it (a core upgrade), and only suggests otherwise', async () => {
    const id = await newBuild(t.storeA1)
    await db.sql`update publish_run set kind = 'upgrade' where id = ${id}`
    const auth = await token(claimsFor(repos.a1, '5801'))
    expect(await reportBuild(deps, auth, sent(id, true, [{ name: 'visual-diff', passed: false, detail: 'The home page looks different from the live site (20.0% of it changed).' }]))).toEqual({ passed: false, upload: false })
  })
})
describe('the upload credential', () => {
  it('is refused before any report, after a failing one, and to another run', async () => {
    const id = await newBuild(t.storeA1)
    const auth = await token(claimsFor(repos.a1, '5601'))
    expect(await refusal(issueCredentials(deps, auth, id))).toBe('wrong_state')
    expect((await run(id))?.github_run_id).toBeNull()
    await reportBuild(deps, auth, report(id, false))
    expect(await refusal(issueCredentials(deps, auth, id))).toBe('wrong_state')
    const passed = await passedBuild(t.storeA1, repos.a1, '5602')
    expect(await refusal(issueCredentials(deps, await token(claimsFor(repos.a1, '5603')), passed.id))).toBe('other_run')
    expect(minted).toEqual([])
  })

  it('names only the build’s staging folder in the private bucket, for 15 minutes', async () => {
    const { id, auth } = await passedBuild(t.storeA2, repos.a2, '5701')
    const credential = await issueCredentials(deps, auth, id)
    expect(credential).toEqual({ endpoint: `https://${parent.accountId}.r2.cloudflarestorage.com`, bucket: 'storefront-sites', prefix: `stores/${t.storeA2}/uploads/${id}/`, ...temporary, expiresAt: '2026-10-11T10:15:00.000Z' })
    expect(minted.at(-1)?.body).toEqual({ bucket: 'storefront-sites', parentAccessKeyId: parent.accessKeyId, permission: 'object-read-write', ttlSeconds: 900, prefixes: [`stores/${t.storeA2}/uploads/${id}/`] })
    // No credential names a build folder, the public bucket or another store.
    for (const { body } of minted) {
      expect(body['bucket']).toBe('storefront-sites')
      expect(body['prefixes']).toEqual([expect.stringMatching(/^stores\/[0-9a-f-]{36}\/uploads\/[0-9a-f-]{36}\/$/)])
      expect(body).not.toHaveProperty('objects')
    }
  })

  it('is never asked for once the build is uploaded', async () => {
    const { id, auth } = await passedBuild(t.storeA1, repos.a1, '5801')
    await db.sql`update publish_run set uploaded_at = now() where id = ${id}`
    expect(await refusal(issueCredentials(deps, auth, id))).toBe('wrong_state')
  })
})

describe('the build calls through the Worker', () => {
  const env = (o: Record<string, unknown> = {}) => ({
    ADMIN_HOST: 'admin.localhost',
    PLATFORM_HOST: 'platform.localhost',
    HOOKS_HOST: 'hooks.localhost',
    GITHUB_LOCAL: '1',
    HYPERDRIVE: { connectionString: db.url },
    HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    BUILD_RATE_LIMITER: { limit: async () => ({ success: true }) },
    CF_VERSION_METADATA: { id: 'test', tag: '' },
    STOREFRONT_SITES: sites,
    PUBLISH_STOREFRONT: { get: async () => ({ sendEvent: async () => undefined }) },
    ...o,
  })
  const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
  const call = (path: string, auth: string | null, body: unknown, e = env()) =>
    worker.fetch(
      new Request(`https://hooks.localhost/builds/${path}`, {
        method: 'POST',
        headers: { 'cf-connecting-ip': '203.0.113.7', 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body),
      }) as Parameters<typeof worker.fetch>[0],
      e as never,
      ctx,
    )
  const localToken = async (claims: Record<string, unknown>) => (await localActions()).mint(claims, 'https://hooks.localhost', new Date())
  const freshBuild = (storeId: string) => newBuild(storeId, { startedAt: new Date(Date.now() - 60_000) })

  it('runs start, report, credentials and uploaded for a verified run, and keeps no token or credential in logs or rows', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')]
    const id = await freshBuild(t.storeA1)
    const auth = await localToken(claimsFor(repos.a1, '5901'))
    const manifest = await manifestOf(site)
    expect((await call('start', auth, { build: id })).status).toBe(200)
    expect((await call('report', auth, { ...report(id), digest: await digestOf(manifest.files) })).status).toBe(200)
    const answer = await call('credentials', auth, { build: id })
    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    const credential = (await answer.json()) as { secretAccessKey: string; sessionToken: string; prefix: string }
    expect(credential.prefix).toBe(`stores/${t.storeA1}/uploads/${id}/`)
    for (const [path, text] of Object.entries(site)) await putText(sites, `${credential.prefix}${path}`, text)
    await putText(sites, `${credential.prefix}_manifest.json`, JSON.stringify(manifest))
    expect(await (await call('uploaded', auth, { build: id })).json()).toEqual({ uploaded: true })
    const logged = logs.flatMap((spy) => spy.mock.calls.map((c) => c.map(String).join(' ')))
    expect(logged.some((l) => l.includes('"event":"build_call"') && l.includes('credentials:accepted'))).toBe(true)
    const rows = (await db.sql<{ text: string }[]>`
      select coalesce((select string_agg(to_jsonb(a)::text, ' ') from activity_log a where store_id = ${t.storeA1}), '')
        || (select to_jsonb(r)::text from publish_run r where id = ${id}) as text`)[0]?.text ?? ''
    for (const secret of [auth, credential.secretAccessKey, credential.sessionToken]) {
      for (const line of logged) expect(line).not.toContain(secret)
      expect(rows).not.toContain(secret)
    }
  })

  it('answers every refusal the same way, and rate limits before it looks at the token', async () => {
    const id = await freshBuild(t.storeA2)
    const wrong = await localToken(claimsFor(repos.a1, '6101'))
    const answers = [
      await call('start', null, { build: id }),
      await call('start', 'forged.token.value-that-is-long-enough', { build: id }),
      await call('start', wrong, { build: id }),
      await call('credentials', await localToken(claimsFor(repos.a2, '6102')), { build: id }),
      await call('start', wrong, { build: id, extra: true }),
    ]
    for (const answer of answers) {
      expect(answer.status).toBe(403)
      expect(await answer.json()).toEqual({ error: 'refused' })
    }
    const limited = await call('start', wrong, { build: id }, env({ BUILD_RATE_LIMITER: { limit: async () => ({ success: false }) } }))
    expect(limited.status).toBe(429)
  })

  it('doesn’t exist without its bucket or the R2 values, nor for another step or method', async () => {
    const auth = await localToken(claimsFor(repos.a1, '6201'))
    expect((await call('start', auth, { build: crypto.randomUUID() }, env({ STOREFRONT_SITES: undefined }))).status).toBe(404)
    expect((await call('start', auth, { build: crypto.randomUUID() }, env({ GITHUB_LOCAL: undefined }))).status).toBe(404)
    expect((await call('start', auth, { build: crypto.randomUUID() }, env({ PUBLISH_STOREFRONT: undefined }))).status).toBe(404)
    expect((await call('publish', auth, {})).status).toBe(404)
    const get = await worker.fetch(new Request('https://hooks.localhost/builds/start', { headers: { 'cf-connecting-ip': '203.0.113.7' } }) as Parameters<typeof worker.fetch>[0], env() as never, ctx)
    expect(get.status).toBe(404)
  })
})

/** A built site: two pages, a hashed script and stylesheet, as the runner hands them to the check step. */
const site = { 'index.html': '<!doctype html><title>Home</title>', 'p/blue/index.html': '<!doctype html><title>Blue</title>', '_next/static/app.3f2a.js': 'console.log(1)', '_next/static/app.9c1d.css': 'body{}' }
const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const manifestOf = async (files: Record<string, string>) => ({ files: await Promise.all(Object.entries(files).map(async ([path, text]) => ({ path, sha256: await sha(text), size: new TextEncoder().encode(text).length }))) })

/** A build that passed with the digest of `files`, and the upload step's work: the files and the manifest staged. */
const stagedBuild = async (storeId: string, repo: { repo: string; id: number }, runId: string, files: Record<string, string> = site) => {
  const id = await newBuild(storeId)
  const auth = await token(claimsFor(repo, runId))
  const manifest = await manifestOf(files)
  await reportBuild(deps, auth, { ...report(id), digest: await digestOf(manifest.files) })
  await issueCredentials(deps, auth, id)
  for (const [path, text] of Object.entries(files)) await putText(sites, `stores/${storeId}/uploads/${id}/${path}`, text)
  await putText(sites, `stores/${storeId}/uploads/${id}/_manifest.json`, JSON.stringify(manifest))
  return { id, auth, manifest }
}

const reads = (prefix: string) => {
  const get = vi.spyOn(sites, 'get')
  return () => get.mock.calls.map(([key]) => key).filter((key) => key.startsWith(prefix))
}

/** The staged object at `key` claims `size` bytes, as one swapped for a huge file would; counts reads of its body. */
const swelled = (key: string, size: number) => {
  const get = sites.get.bind(sites)
  let bodyReads = 0
  vi.spyOn(sites, 'get').mockImplementation(async (k) => {
    const found = await get(k)
    if (k !== key || !found) return found
    return { ...found, size, arrayBuffer: async () => ((bodyReads += 1), found.arrayBuffer()) }
  })
  return () => bodyReads
}

const verifyDeps = () => ({ sql: db.sql, sites, assets, now: () => now, probe: testProbe(db.sql, { sites, assets }), assetHost: 'sf-assets.dripfunnel.com', wait: async () => undefined })
const uploadOf = (id: string) => db.sql<{ uploaded_at: Date | null; upload_manifest: unknown; verified_at: Date | null; state: string; error: string | null }[]>`
  select uploaded_at, upload_manifest, verified_at, state, error from publish_run where id = ${id}`.then((r) => r[0])
const verifyRefusal = (work: Promise<unknown>) =>
  work.then(
    () => 'verified',
    (error: unknown) => (error instanceof UploadRefused ? error.code : String(error)),
  )

describe('"uploaded"', () => {
  it('keeps the manifest whose digest is the passing report’s, ends the credentials and wakes the run', async () => {
    const { id, auth, manifest } = await stagedBuild(t.storeA1, repos.a1, '7001')
    woken.length = 0
    expect(await reportUploaded(deps, auth, id)).toEqual({ uploaded: true })
    expect(await uploadOf(id)).toMatchObject({ upload_manifest: manifest, verified_at: null, state: 'deploying' })
    expect(woken).toEqual([`${id}:uploaded`])
    expect(await refusal(issueCredentials(deps, auth, id))).toBe('wrong_state')
    // A retry is answered the same and wakes the run again; nothing is read twice into the row.
    expect(await reportUploaded(deps, auth, id)).toEqual({ uploaded: true })
    expect(woken).toEqual([`${id}:uploaded`, `${id}:uploaded`])
  })

  it('refuses a manifest whose digest isn’t the report’s, and a missing one, and the build never verifies', async () => {
    const { id, auth } = await stagedBuild(t.storeA2, repos.a2, '7101')
    await putText(sites, `stores/${t.storeA2}/uploads/${id}/_manifest.json`, JSON.stringify(await manifestOf({ ...site, 'index.html': 'something else' })))
    expect(await refusal(reportUploaded(deps, auth, id))).toBe('manifest_refused')
    expect(await uploadOf(id)).toMatchObject({ upload_manifest: null })
    expect((await uploadOf(id))?.uploaded_at).not.toBeNull()
    expect(await refusal(reportUploaded(deps, auth, id))).toBe('manifest_refused')
    expect(await verifyRefusal(verifyUpload(verifyDeps(), t.storeA2, id))).toBe('manifest_refused')
    const missing = await stagedBuild(t.storeA2, repos.a2, '7102')
    await sites.delete([`stores/${t.storeA2}/uploads/${missing.id}/_manifest.json`])
    expect(await refusal(reportUploaded(deps, missing.auth, missing.id))).toBe('manifest_refused')
  })

  it('refuses a staged manifest too large to be one without reading it', async () => {
    const { id, auth } = await stagedBuild(t.storeA2, repos.a2, '7103')
    const bodyReads = swelled(`stores/${t.storeA2}/uploads/${id}/_manifest.json`, 500_000_000)
    expect(await refusal(reportUploaded(deps, auth, id))).toBe('manifest_refused')
    expect(bodyReads()).toBe(0)
    expect(await uploadOf(id)).toMatchObject({ upload_manifest: null })
  })

  it('is refused before a passing report and to another run', async () => {
    const id = await newBuild(t.storeA1)
    const auth = await token(claimsFor(repos.a1, '7201'))
    expect(await refusal(reportUploaded(deps, auth, id))).toBe('wrong_state')
    const staged = await stagedBuild(t.storeA1, repos.a1, '7202')
    expect(await refusal(reportUploaded(deps, await token(claimsFor(repos.a1, '7203')), staged.id))).toBe('other_run')
  })
})

describe('the copy into the build’s folders', () => {
  it('reads each staged object once and copies it only when it hashes to its entry; JS and CSS reach the public bucket from the private folder', async () => {
    const { id, auth, manifest } = await stagedBuild(t.storeA1, repos.a1, '7301')
    await reportUploaded(deps, auth, id)
    const staged = reads(`stores/${t.storeA1}/uploads/${id}/`)
    await verifyUpload(verifyDeps(), t.storeA1, id)
    expect(staged().sort()).toEqual(Object.keys(site).map((p) => `stores/${t.storeA1}/uploads/${id}/${p}`).sort())
    expect(sites.keys(`stores/${t.storeA1}/builds/${id}/`)).toEqual([...Object.keys(site), '_manifest.json'].map((p) => `stores/${t.storeA1}/builds/${id}/${p}`).sort())
    expect(assets.keys('')).toEqual([`stores/${t.storeA1}/builds/${id}/assets/_next/static/app.3f2a.js`, `stores/${t.storeA1}/builds/${id}/assets/_next/static/app.9c1d.css`])
    expect(JSON.parse(new TextDecoder().decode(sites.objects.get(`stores/${t.storeA1}/builds/${id}/_manifest.json`)?.bytes))).toEqual(manifest)
    expect(sites.objects.get(`stores/${t.storeA1}/builds/${id}/index.html`)?.contentType).toBe('text/html; charset=utf-8')
    expect((await uploadOf(id))?.verified_at).not.toBeNull()
  })

  it('never uses a file swapped in the staging folder after "uploaded", nor one added there', async () => {
    const { id, auth } = await stagedBuild(t.storeA2, repos.a2, '7401')
    await reportUploaded(deps, auth, id)
    await putText(sites, `stores/${t.storeA2}/uploads/${id}/index.html`, '<script>steal()</script>')
    await putText(sites, `stores/${t.storeA2}/uploads/${id}/extra.html`, 'not in the manifest')
    expect(await verifyRefusal(verifyUpload(verifyDeps(), t.storeA2, id))).toBe('file_mismatch')
    expect(sites.keys(`stores/${t.storeA2}/builds/${id}/`)).toEqual([])
    expect(assets.keys(`stores/${t.storeA2}/builds/${id}/`)).toEqual([])
    expect((await uploadOf(id))?.verified_at).toBeNull()
  })

  it('refuses a staged file swapped for a larger one without reading it', async () => {
    const { id, auth } = await stagedBuild(t.storeA1, repos.a1, '7402')
    await reportUploaded(deps, auth, id)
    const bodyReads = swelled(`stores/${t.storeA1}/uploads/${id}/index.html`, 500_000_000)
    expect(await verifyRefusal(verifyUpload(verifyDeps(), t.storeA1, id))).toBe('file_mismatch')
    expect(bodyReads()).toBe(0)
    expect((await uploadOf(id))?.verified_at).toBeNull()
  })

  it('refuses a staged file that is missing', async () => {
    const { id, auth } = await stagedBuild(t.storeA1, repos.a1, '7501')
    await reportUploaded(deps, auth, id)
    await sites.delete([`stores/${t.storeA1}/uploads/${id}/p/blue/index.html`])
    expect(await verifyRefusal(verifyUpload(verifyDeps(), t.storeA1, id))).toBe('file_missing')
  })
})

describe('a build from its report to live', () => {
  const steps = { do: (_: string, work: () => Promise<string>) => work(), waitFor: async () => undefined }
  const publishDeps = () => ({ sql: db.sql, sites, assets, drafts: fakeSites(), assetOrigin: null, shopDomain: null, dispatch: async () => true, now: () => now, probe: testProbe(db.sql, { sites, assets }), assetHost: 'sf-assets.dripfunnel.com', wait: async () => undefined })

  it('goes live only after its upload is verified, through #317’s switch', async () => {
    const { id, auth } = await stagedBuild(t.storeA2, repos.a2, '7601')
    // Before "uploaded" the run waits, and with no upload the wait ends in a failure that leaves the live build alone.
    const waiting = await newBuild(t.storeA1)
    await db.sql`update publish_run set state = 'deploying', gate = ${db.sql.json({ passed: true, checks: [] })}, gate_digest = ${'d'.repeat(64)} where id = ${waiting}`
    const timeout = { ...steps, waitFor: async () => Promise.reject(new Error('timed out')) }
    expect(await runPublish(publishDeps(), { runId: waiting, storeId: t.storeA1 }, timeout)).toBe('failed')
    expect(await uploadOf(waiting)).toMatchObject({ state: 'failed', error: 'upload_timed_out' })
    await reportUploaded(deps, auth, id)
    expect(await runPublish(publishDeps(), { runId: id, storeId: t.storeA2 }, steps)).toBe('live')
    expect((await db.sql<{ live_build_id: string }[]>`select live_build_id from storefront where store_id = ${t.storeA2}`)[0]?.live_build_id).toBe(id)
    expect(sites.keys(`stores/${t.storeA2}/uploads/${id}/`)).toEqual([])
  })

  it('fails a publish whose upload was swapped, and the pointer never moves', async () => {
    const before = (await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${t.storeA2}`)[0]?.live_build_id
    const { id, auth } = await stagedBuild(t.storeA2, repos.a2, '7701')
    await reportUploaded(deps, auth, id)
    await putText(sites, `stores/${t.storeA2}/uploads/${id}/_next/static/app.3f2a.js`, 'fetch("https://evil.example")')
    expect(await runPublish(publishDeps(), { runId: id, storeId: t.storeA2 }, steps)).toBe('failed')
    expect(await uploadOf(id)).toMatchObject({ state: 'failed', error: 'file_mismatch', verified_at: null })
    expect((await db.sql<{ live_build_id: string | null }[]>`select live_build_id from storefront where store_id = ${t.storeA2}`)[0]?.live_build_id).toBe(before)
  })
})

describe('the locked workflow’s upload step', () => {
  const workflow = readFileSync(new URL('../../../templates/storefront/.github/workflows/build.yml', import.meta.url), 'utf8')
  const manifestScript = (/<<'PY'\n([\s\S]*?)\n\s*PY\n/.exec(workflow)?.[1] ?? '').replace(/^ {10}/gm, '')

  it('runs only when the platform dispatches it, with the OIDC permission alone, and no action or repo code', () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:\n/m)
    expect(workflow).not.toMatch(/^\s*(push|pull_request|pull_request_target|schedule|workflow_run):/m)
    expect(workflow).toMatch(/^permissions:\n {2}id-token: write\nconcurrency:/m)
    expect(workflow).not.toMatch(/^\s*-?\s*uses:/m)
    expect(workflow).not.toMatch(/\b(npm|pnpm|npx|yarn)\b|actions\/checkout/)
    expect(workflow).toContain('"$API/builds/$1"')
    expect(workflow).toContain('--no-follow-symlinks')
  })

  it('lists the site as the API’s digest reads it, and stops at a link', async () => {
    const root = mkdtempSync(join(tmpdir(), 'site-'))
    try {
      for (const [path, text] of Object.entries(site)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), text)
      }
      const listed = JSON.parse(execFileSync('python3', ['-c', manifestScript, root], { encoding: 'utf8' })) as { files: { path: string; sha256: string; size: number }[] }
      expect(listed).toEqual({ files: [...(await manifestOf(site)).files].sort((a, b) => (a.path < b.path ? -1 : 1)) })
      expect(await digestOf(listed.files)).toBe(await digestOf((await manifestOf(site)).files))
      symlinkSync('/etc/hosts', join(root, 'leak.html'))
      expect(() => execFileSync('python3', ['-c', manifestScript, root], { stdio: 'pipe' })).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
