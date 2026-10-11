import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { actionsIssuer, actionsKeys } from '#integrations/github/oidc'
import { storefrontR2 } from '#integrations/cloudflare/r2'
import { localActions } from '#integrations/local/builds'
import { BuildRefused, buildLifetimeMs, issueCredentials, reportBuild, startBuild, type BuildDeps, type GateReport } from '#saas/builds/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
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
  deps = { sql: db.sql, keys: actionsKeys(fakeGitHub), audience, org: 'dripfunnel', r2: storefrontR2(parent, fakeCloudflare), buckets: { sites: 'storefront-sites', drafts: 'storefront-drafts' }, sites, now: () => now }
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
    expect(await reportBuild(deps, auth, report(id))).toEqual({ passed: true })
    expect(await reportBuild(deps, auth, report(id))).toEqual({ passed: true })
    expect(await run(id)).toMatchObject({ state: 'deploying', github_run_id: '5401', gate_digest: 'd'.repeat(64), gate: { passed: true, checks: [{ name: 'contract', passed: true }, { name: 'axe', passed: true }] } })
    expect(await refusal(reportBuild(deps, auth, { ...report(id), digest: '0'.repeat(64) }))).toBe('wrong_state')
    expect(await refusal(reportBuild(deps, await token(claimsFor(repos.a1, '5402')), report(id)))).toBe('other_run')
  })

  it('is taken only from a run GitHub signed, never from a token anyone else made', async () => {
    const id = await newBuild(t.storeA1)
    expect(await refusal(reportBuild(deps, await token(claimsFor(repos.a1, '5451'), { key: stranger }), report(id)))).toBe('bad_token')
    expect(await run(id)).toMatchObject({ state: 'building', gate: null, github_run_id: null })
  })

  it('ends the build on a failing report, naming the checks that failed', async () => {
    const id = await newBuild(t.storeA1)
    const auth = await token(claimsFor(repos.a1, '5501'))
    expect(await reportBuild(deps, auth, report(id, false))).toEqual({ passed: false })
    expect(await run(id)).toMatchObject({ state: 'failed', error: 'gate_failed' })
    const [entry] = await db.sql<{ action: string; reason: string }[]>`select action, reason from activity_log where target_id = ${id} and action like 'storefront.build_%ed'`
    expect(entry).toEqual({ action: 'storefront.build_failed', reason: 'axe' })
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

  it('runs start, report and credentials for a verified run, and keeps no token or credential in logs or rows', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')]
    const id = await freshBuild(t.storeA1)
    const auth = await localToken(claimsFor(repos.a1, '5901'))
    expect((await call('start', auth, { build: id })).status).toBe(200)
    expect((await call('report', auth, report(id))).status).toBe(200)
    const answer = await call('credentials', auth, { build: id })
    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    const credential = (await answer.json()) as { secretAccessKey: string; sessionToken: string; prefix: string }
    expect(credential.prefix).toBe(`stores/${t.storeA1}/uploads/${id}/`)
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
    expect((await call('publish', auth, {})).status).toBe(404)
    const get = await worker.fetch(new Request('https://hooks.localhost/builds/start', { headers: { 'cf-connecting-ip': '203.0.113.7' } }) as Parameters<typeof worker.fetch>[0], env() as never, ctx)
    expect(get.status).toBe(404)
  })
})
