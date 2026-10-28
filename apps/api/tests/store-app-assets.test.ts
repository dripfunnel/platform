import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { actingCaller } from '#apis/store/access'
import { handleAppAssets } from '#apis/store/appAssets'
import { hashSessionId } from '#auth/session'
import { withScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import type { BrandFileStore } from '#saas/partnerBranding/index'
import { exchangeSupportHandoff } from '#saas/storeSupport/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #868 (SH 15): Settings › Mobile apps in the Store API: the Owner's, with `own_apps` on the plan; the images held to the
// partner's rules (BUILD-CHECKLIST §2); each save a new version.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
const now = () => new Date()

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

// The ASSETS bucket, in memory.
const stored = new Map<string, Uint8Array>()
const files: BrandFileStore = {
  put: async (key, value) => void stored.set(key, value),
  get: async (key) => {
    const bytes = stored.get(key)
    return bytes ? { body: new Response(bytes as BodyInit).body as ReadableStream } : null
  },
}

/** `own_apps` on the store's plan, or off. */
const allow = async (storeId: string, on: boolean) => {
  const [store] = await db.sql<{ plan_id: string; partner_id: string }[]>`select plan_id, partner_id from store where id = ${storeId}`
  await db.sql`delete from plan_entitlement where plan_id = ${store?.plan_id ?? ''} and key = 'own_apps'`
  if (on) await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled, amount) values (${store?.plan_id ?? ''}, ${store?.partner_id ?? ''}, 1, 'own_apps', true, null)`
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
// A PNG's signature and IHDR at a size and colour type (6 has alpha), enough for the server's checks.
const pngOf = (width: number, height: number, colourType = 2) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...new TextEncoder().encode('IHDR'), ...u32(width), ...u32(height), 8, colourType, 0, 0, 0, 0, 0, 0, 0])
const icon = () => pngOf(1024, 1024)

const send = async (who: Who, kind: string, body: Uint8Array) => {
  const response = await handleAppAssets(new Request(`https://store.example/api/app-assets?kind=${kind}`, { method: 'POST', body: body as BodyInit }), await w.context(who), files)
  const answer = (await response.json()) as { ok: boolean; code?: string; key?: string }
  return { status: response.status, ...answer }
}
const readBack = async (who: Who, key: string) => (await handleAppAssets(new Request(`https://store.example/api/app-assets?key=${encodeURIComponent(key)}`), await w.context(who), files)).status

type Assets = { version: number; appIcon: string | null; appIconForeground: string | null; splash: string | null; appName: string | null; shortDescription: string | null; longDescription: string | null }

const read = async (who: Who) => {
  const r = await w.gql(who, '{ mobileApps { available current { version appIcon appIconForeground splash appName shortDescription longDescription savedAt } } }')
  return { apps: r.data?.['mobileApps'] as { available: boolean; current: (Assets & { savedAt: string }) | null } | undefined, code: r.code }
}
const save = async (who: Who, input: Record<string, unknown>) => {
  const r = await w.gql(who, 'mutation S($input: MobileAppsInput!) { saveMobileApps(input: $input) { version appIcon appIconForeground splash appName shortDescription longDescription } }', { input })
  return { saved: r.data?.['saveMobileApps'] as Assets | undefined, code: r.code, extensions: r.extensions }
}
const logged = async (storeId: string, action: string) => {
  const [row] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = ${action} and store_id = ${storeId}`
  return row?.n ?? 0
}
const versions = async (storeId: string) => (await db.sql<{ version: number }[]>`select version from store_app_assets where store_id = ${storeId} order by version`).map((r) => r.version)

describe('a plan without own_apps', () => {
  it('has no tab to show, and refuses an upload and a save, naming the plan', async () => {
    await allow(w.storeOf('owner'), false)
    expect(await read('owner')).toMatchObject({ apps: { available: false, current: null } })
    expect(await send('owner', 'appIcon', icon())).toMatchObject({ status: 403, code: 'PLAN_LIMIT' })
    const saved = await save('owner', { appName: 'Acme' })
    expect(saved.code).toBe('PLAN_LIMIT')
    expect(saved.extensions).toMatchObject({ key: 'own_apps' })
    expect(await versions(w.storeOf('owner'))).toEqual([])
  })
})

describe('the images', () => {
  beforeAll(async () => {
    await allow(w.storeOf('owner'), true)
  })

  it('are stored under the store’s own prefix, the key answered, and each upload logged with who did it', async () => {
    const answer = await send('owner', 'appIcon', icon())
    expect(answer).toMatchObject({ status: 200, ok: true })
    expect(answer.key).toMatch(new RegExp(`^stores/${w.storeOf('owner')}/app/appIcon-[0-9a-f-]{36}\\.png$`))
    expect(stored.has(answer.key ?? '')).toBe(true)
    const [entry] = await db.sql<{ actor_id: string; target_label: string }[]>`select actor_id, target_label from activity_log where action = 'mobile_app.file_uploaded' and target_id = ${answer.key ?? ''}`
    expect(entry).toEqual({ actor_id: w.people.owner, target_label: 'appIcon' })
  })

  it('take the Android foreground with a transparent background, and a splash of any size', async () => {
    expect((await send('owner', 'appIconForeground', pngOf(1024, 1024, 6))).status).toBe(200)
    expect((await send('owner', 'splash', pngOf(1242, 2688, 6))).status).toBe(200)
  })

  it('refuse what is not a PNG, an icon that is not 1024 × 1024, an app icon that can be transparent, and a file over 512 KB', async () => {
    expect(await send('owner', 'appIcon', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toMatchObject({ status: 415, code: 'NOT_PNG' })
    expect(await send('owner', 'appIcon', new Uint8Array([1, 2, 3, 4]))).toMatchObject({ status: 415, code: 'NOT_PNG' })
    expect(await send('owner', 'appIcon', pngOf(512, 512))).toMatchObject({ status: 422, code: 'WRONG_DIMENSIONS' })
    expect(await send('owner', 'appIconForeground', pngOf(1024, 1000, 6))).toMatchObject({ status: 422, code: 'WRONG_DIMENSIONS' })
    expect(await send('owner', 'appIcon', pngOf(1024, 1024, 6))).toMatchObject({ status: 422, code: 'HAS_TRANSPARENCY' })
    const big = new Uint8Array(512 * 1024 + 1)
    big.set(icon())
    expect(await send('owner', 'appIcon', big)).toMatchObject({ status: 413, code: 'TOO_LARGE' })
    expect(await send('owner', 'logo', icon())).toMatchObject({ status: 400, code: 'INVALID_KIND' })
  })

  it('store nothing and log nothing for a refused file', async () => {
    const before = await logged(w.storeOf('owner'), 'mobile_app.file_uploaded')
    const kept = stored.size
    await send('owner', 'appIcon', pngOf(512, 512))
    expect(await logged(w.storeOf('owner'), 'mobile_app.file_uploaded')).toBe(before)
    expect(stored.size).toBe(kept)
  })

  it('are read back for the portal’s previews by the store that uploaded them only', async () => {
    const { key } = await send('owner', 'splash', pngOf(100, 200))
    expect(await readBack('owner', key ?? '')).toBe(200)
    expect(await readBack('bOwner', key ?? '')).toBe(404)
    expect(await readBack('owner', 'stores/someone-else/app/splash-x.png')).toBe(404)
  })
})

describe('saving', () => {
  let iconKey = ''
  let foregroundKey = ''
  let splashKey = ''
  beforeAll(async () => {
    await allow(w.storeOf('owner'), true)
    iconKey = (await send('owner', 'appIcon', icon())).key ?? ''
    foregroundKey = (await send('owner', 'appIconForeground', pngOf(1024, 1024, 6))).key ?? ''
    splashKey = (await send('owner', 'splash', pngOf(1242, 2688, 6))).key ?? ''
  })

  it('adds a version with the images and the listing text, trimmed, and the portal reads it back', async () => {
    const first = await save('owner', { appIcon: iconKey, appIconForeground: foregroundKey, splash: splashKey, appName: '  Acme  ', shortDescription: 'Fresh daily', longDescription: 'Everything we bake.' })
    expect(first.code).toBeUndefined()
    expect(first.saved).toEqual({ version: 1, appIcon: iconKey, appIconForeground: foregroundKey, splash: splashKey, appName: 'Acme', shortDescription: 'Fresh daily', longDescription: 'Everything we bake.' })
    const now = await read('owner')
    expect(now.apps?.available).toBe(true)
    expect(now.apps?.current).toMatchObject({ version: 1, appName: 'Acme' })
    const [entry] = await db.sql<{ actor_id: string; target_label: string }[]>`select actor_id, target_label from activity_log where action = 'mobile_app.assets_saved' and store_id = ${w.storeOf('owner')}`
    expect(entry).toEqual({ actor_id: w.people.owner, target_label: 'version 1' })
  })

  it('keeps every version, changing none: a new save adds one, and saving what is live adds nothing', async () => {
    const same = await save('owner', { appIcon: iconKey, appIconForeground: foregroundKey, splash: splashKey, appName: 'Acme', shortDescription: 'Fresh daily', longDescription: 'Everything we bake.' })
    expect(same.saved?.version).toBe(1)
    expect(await versions(w.storeOf('owner'))).toEqual([1])
    const changed = await save('owner', { appIcon: iconKey, appName: 'Acme Bakery' })
    expect(changed.saved).toMatchObject({ version: 2, appName: 'Acme Bakery', appIconForeground: null, splash: null, shortDescription: null })
    expect(await versions(w.storeOf('owner'))).toEqual([1, 2])
    expect(await logged(w.storeOf('owner'), 'mobile_app.assets_saved')).toBe(2)
    expect((await read('owner')).apps?.current?.version).toBe(2)
  })

  it('takes empty text as none, and each image as optional', async () => {
    const cleared = await save('owner', { appName: '   ', shortDescription: '' })
    expect(cleared.saved).toMatchObject({ appName: null, shortDescription: null, appIcon: null })
  })

  it('refuses text past its limit, and an image this store did not upload as that kind', async () => {
    expect((await save('owner', { appName: 'x'.repeat(31) })).code).toBe('INVALID_INPUT')
    expect((await save('owner', { shortDescription: 'x'.repeat(81) })).code).toBe('INVALID_INPUT')
    expect((await save('owner', { longDescription: 'x'.repeat(4001) })).code).toBe('INVALID_INPUT')
    expect((await save('owner', { appName: 'x'.repeat(30), shortDescription: 'x'.repeat(80), longDescription: 'x'.repeat(4000) })).code).toBeUndefined()
    // The foreground's key is not an app icon's, a made-up key is nobody's, and another store's is not this one's.
    expect((await save('owner', { appIcon: foregroundKey })).code).toBe('UNKNOWN_FILE')
    expect((await save('owner', { appIcon: `stores/${w.storeOf('owner')}/app/appIcon-00000000-0000-4000-8000-000000000000.png/../x` })).code).toBe('UNKNOWN_FILE')
    // A well-formed key for this store and kind that was never uploaded names nothing, and is refused too.
    const before = await versions(w.storeOf('owner'))
    expect((await save('owner', { appIcon: `stores/${w.storeOf('owner')}/app/appIcon-00000000-0000-4000-8000-000000000000.png` })).code).toBe('UNKNOWN_FILE')
    expect(await versions(w.storeOf('owner'))).toEqual(before)
    const theirs = (await send('bOwner', 'appIcon', icon())).key
    await allow(w.storeOf('bOwner'), true)
    const other = (await send('bOwner', 'appIcon', icon())).key ?? theirs ?? ''
    expect((await save('owner', { appIcon: other })).code).toBe('UNKNOWN_FILE')
  })

  it('never lets a role change or delete a version, the Owner’s included', async () => {
    const context = actingCaller(await w.context('owner')).context
    await expect(withScope(db.sql, context, (tx) => tx`update store_app_assets set app_name = 'Hacked' where store_id = ${w.storeOf('owner')}`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, context, (tx) => tx`delete from store_app_assets where store_id = ${w.storeOf('owner')}`)).rejects.toThrow(/permission denied/)
  })
})

describe('a store or a session that may not write', () => {
  beforeAll(async () => {
    await allow(w.storeOf('owner'), true)
  })

  const untouched = async (work: () => Promise<void>) => {
    const before = { versions: await versions(w.storeOf('owner')), objects: stored.size, uploads: await logged(w.storeOf('owner'), 'mobile_app.file_uploaded'), saves: await logged(w.storeOf('owner'), 'mobile_app.assets_saved') }
    await work()
    expect({ versions: await versions(w.storeOf('owner')), objects: stored.size, uploads: await logged(w.storeOf('owner'), 'mobile_app.file_uploaded'), saves: await logged(w.storeOf('owner'), 'mobile_app.assets_saved') }).toEqual(before)
  }

  it('refuses an upload and a save while the store is past due, writing no version, object or entry, and keeps reading', async () => {
    await db.sql`update store set status = 'past_due' where id = ${w.storeOf('owner')}`
    try {
      await untouched(async () => {
        expect(await send('owner', 'appIcon', icon())).toMatchObject({ status: 403, code: 'READ_ONLY' })
        expect((await save('owner', { appName: 'Late' })).code).toBe('READ_ONLY')
      })
      expect((await read('owner')).code).toBeUndefined()
    } finally {
      await db.sql`update store set status = 'active' where id = ${w.storeOf('owner')}`
    }
  })

  it('refuses an upload and a save in a read-only support session, writing no version, object or entry, and lets it read', async () => {
    const [agent] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${t.partnerA}, 'priya@partner-a.example', 'Priya', 'partner-support', 'active') returning id`
    const [seat] = await db.sql<{ id: string }[]>`select id from membership where user_id = ${w.people.owner}`
    const at = now()
    await db.sql`
      insert into support_session (partner_id, store_id, membership_id, partner_user_id, reason, started_at, expires_at, handoff_hash, handoff_expires_at, access)
      values (${t.partnerA}, ${t.storeA1}, ${seat?.id ?? ''}, ${agent?.id ?? ''}, 'Help', ${at}, ${new Date(at.getTime() + 30 * 60_000)}, ${await hashSessionId('tok-apps')}, ${new Date(at.getTime() + 5 * 60_000)}, 'read')`
    const entered = await exchangeSupportHandoff({ sql: db.sql, partnerId: t.partnerA, activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, now }, 'tok-apps')
    const cookie = entered?.cookie ?? ''
    expect(cookie).not.toBe('')
    await untouched(async () => {
      const response = await handleAppAssets(new Request('https://store.example/api/app-assets?kind=appIcon', { method: 'POST', body: icon() as BodyInit }), await w.supportContext(cookie, t.partnerA), files)
      expect(response.status).toBe(403)
      expect(((await response.json()) as { code: string }).code).toBe('SUPPORT_READ_ONLY')
      const saved = await w.support(cookie, t.partnerA, 'mutation { saveMobileApps(input: { appName: "Support" }) { version } }')
      expect(saved.code).toBe('SUPPORT_READ_ONLY')
    })
    expect((await w.support(cookie, t.partnerA, '{ mobileApps { available } }')).code).toBeUndefined()
  })

  it('has the row-level policy refuse an insert in a read-only support session too, whatever the code above does', async () => {
    const insert = (support: string) =>
      db.sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe('set local role app_request')
        for (const [k, v] of [['app.scope', 'store'], ['app.partner_id', t.partnerA], ['app.store_id', t.storeA1], ['app.seller_id', ''], ['app.support', support]] as const) await tx`select set_config(${k}, ${v}, true)`
        return tx`insert into store_app_assets (store_id, version, app_name) values (${t.storeA1}, 999, 'Raw') returning version`
      })
    await expect(insert('read')).rejects.toThrow(/row-level security/)
    expect(await insert('')).toEqual([{ version: 999 }])
    await db.sql`delete from store_app_assets where store_id = ${t.storeA1} and version = 999`
  })
})

describe('who may', () => {
  beforeAll(async () => {
    await allow(w.storeOf('owner'), true)
  })

  it('be the Owner only: a manager, staff and a supplier read, upload and save nothing', async () => {
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await read(who)).code, who).toBe('FORBIDDEN')
      expect((await save(who, { appName: 'Nope' })).code, who).toBe('FORBIDDEN')
      expect((await send(who, 'appIcon', icon())).status, who).toBe(403)
    }
  })

  it('see nothing of another store’s: Store B, with no plan switch, has an empty tab, and Store A2 sees none of A1’s versions', async () => {
    await allow(w.storeOf('bOwner'), false)
    expect(await read('bOwner')).toMatchObject({ apps: { available: false, current: null } })
    await allow(w.storeOf('a2Owner'), true)
    expect(await read('a2Owner')).toMatchObject({ apps: { available: true, current: null } })
    expect(await db.sql`select 1 from store_app_assets where store_id = ${w.storeOf('a2Owner')}`).toHaveLength(0)
  })

  it('save into the caller’s own store whatever a request says', async () => {
    await allow(w.storeOf('a2Owner'), true)
    const saved = await save('a2Owner', { appName: 'A2 only' })
    expect(saved.saved?.version).toBe(1)
    const owners = await db.sql<{ store_id: string }[]>`select store_id from store_app_assets where app_name = 'A2 only'`
    expect(owners).toEqual([{ store_id: w.storeOf('a2Owner') }])
  })
})
