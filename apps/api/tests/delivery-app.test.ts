import { graphql } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleDeliveryApp, matchDeliveryAppPath } from '#apis/admin/deliveryApp'
import { handleDeliveryApk, type ApkFiles } from '#apis/delivery/apk'
import { deliverySchema, type DeliveryContext } from '#apis/delivery/schema'
import type { DeliveryCaller } from '#auth/riderCaller'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { selectLatestDeliveryApp } from '#db/scoped/storeDeliveryApp'
import { activityLog } from '#saas/activity/index'
import { createDeliveryApp, deliveryAppAudit, maxApkBytes, type DeliveryAppStore } from '#saas/deliveryApp/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #852 (DL 15): a store's delivery app APK, uploaded by staff with `stores.deliveryApp.write`, audited with a reason, kept under the
// store's own prefix, with a minimum build that only staff set.

let db: TestDatabase
const now = new Date('2026-10-28T12:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
const facts = factsOf(new Request('https://admin.dripfunnel.ai/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } }))

// The ASSETS bucket, in memory.
const stored = new Map<string, Uint8Array>()
const bucket: DeliveryAppStore = {
  put: async (key, body) => {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
    stored.set(key, bytes)
    return { size: bytes.byteLength }
  },
  get: async (key, options) => {
    const bytes = stored.get(key)
    if (!bytes) return null
    const part = options?.range ? bytes.slice(options.range.offset, options.range.offset + options.range.length) : bytes
    return { arrayBuffer: async () => part.slice().buffer }
  },
  delete: async (key) => void stored.delete(key),
}

const apk = (extra = 32) => new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Uint8Array(extra)])
const streamOf = (bytes: Uint8Array) => new Response(bytes as BodyInit).body

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}
const serviceFor = (role: StaffRole, files: DeliveryAppStore | null = bucket) => createDeliveryApp({ sql: db.sql, staff: as(role), facts, activity: activityLog, isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target), files })

const storeIdOf = async (name: string): Promise<string> => {
  const [row] = await db.sql<{ id: string }[]>`select id from store where name = ${name}`
  if (!row) throw new Error(`store ${name} missing`)
  return row.id
}

const upload = (role: StaffRole, storeId: string, over: Record<string, unknown> = {}, bytes: Uint8Array = apk(), files: DeliveryAppStore | null = bucket) =>
  serviceFor(role, files).upload(storeId, { versionName: '1.0.0', buildNumber: 1, reason: 'First build for the pilot store', ...over }, streamOf(bytes), bytes.byteLength)

const logged = async (storeId: string, action: string) => {
  const [row] = await db.sql<{ n: number }[]>`select count(*)::int as n from activity_log where action = ${action} and store_id = ${storeId}`
  return row?.n ?? 0
}
const versions = async (storeId: string) => (await db.sql<{ version: number; build_number: number; minimum_build: number | null }[]>`select version, build_number, minimum_build from store_delivery_app where store_id = ${storeId} order by version`)

let mehta: string
let maple: string

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const rows = await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`
  for (const r of rows) if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, { id: r.id, email: r.email, name: r.name, role: r.role_key })
  mehta = await storeIdOf('Mehta Textiles')
  maple = await storeIdOf('Maple & Pine Home')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('uploading the APK', () => {
  it('keeps it under the store’s own prefix as version 1, and records who, what and why', async () => {
    const result = await upload('staff-super-admin', mehta)
    expect(result).toMatchObject({ ok: true, value: { version: 1, versionName: '1.0.0', buildNumber: 1, minimumBuild: null } })
    const [row] = await db.sql<{ apk_key: string; size_bytes: string }[]>`select apk_key, size_bytes from store_delivery_app where store_id = ${mehta}`
    expect(row?.apk_key.startsWith(`stores/${mehta}/delivery-app/`)).toBe(true)
    expect(row?.apk_key.endsWith('.apk')).toBe(true)
    expect(stored.get(row?.apk_key ?? '')?.byteLength).toBe(36)
    expect(row?.size_bytes).toBe('36')
    const [entry] = await db.sql<{ actor_label: string; reason: string | null; actor_kind: string }[]>`
      select actor_label, reason, actor_kind from activity_log where store_id = ${mehta} and action = ${deliveryAppAudit.uploaded}
    `
    expect(entry).toMatchObject({ actor_kind: 'staff', reason: 'First build for the pilot store' })
    expect(entry?.actor_label).toContain(as('staff-super-admin').email)
  })

  it('lets only roles with stores.deliveryApp.write upload, and leaves no row, entry or file for the rest', async () => {
    const filesBefore = stored.size
    for (const role of ['staff-partner-manager', 'staff-support', 'staff-read-only'] as const) {
      expect([role, await upload(role, maple)]).toEqual([role, { ok: false, code: 'FORBIDDEN' }])
    }
    expect(await versions(maple)).toEqual([])
    expect(await logged(maple, deliveryAppAudit.uploaded)).toBe(0)
    expect(stored.size).toBe(filesBefore)
    expect((await upload('staff-engineer', maple)).ok).toBe(true)
  })

  it('refuses a file that is not an APK, and keeps nothing of it', async () => {
    const before = { files: stored.size, entries: await logged(mehta, deliveryAppAudit.uploaded), rows: (await versions(mehta)).length }
    const result = await upload('staff-super-admin', mehta, { buildNumber: 2 }, new TextEncoder().encode('not a zip at all'))
    expect(result).toEqual({ ok: false, code: 'NOT_AN_APK' })
    expect({ files: stored.size, entries: await logged(mehta, deliveryAppAudit.uploaded), rows: (await versions(mehta)).length }).toEqual(before)
  })

  it('refuses a body whose stored size differs from the length sent, and keeps nothing of it', async () => {
    const before = { files: stored.size, entries: await logged(mehta, deliveryAppAudit.uploaded), rows: (await versions(mehta)).length }
    const bytes = apk()
    const result = await serviceFor('staff-super-admin').upload(mehta, { versionName: '1.0.9', buildNumber: 9, reason: 'Wrong length' }, streamOf(bytes), bytes.byteLength + 10)
    expect(result).toEqual({ ok: false, code: 'INVALID_INPUT' })
    expect({ files: stored.size, entries: await logged(mehta, deliveryAppAudit.uploaded), rows: (await versions(mehta)).length }).toEqual(before)
  })

  it('removes the object and keeps no row when the bucket fails midway', async () => {
    const before = { files: stored.size, entries: await logged(mehta, deliveryAppAudit.uploaded), rows: (await versions(mehta)).length }
    const failing: DeliveryAppStore = { ...bucket, put: async (key, body) => { await bucket.put(key, body); throw new Error('R2 unavailable') } }
    await expect(upload('staff-super-admin', mehta, { buildNumber: 9 }, apk(), failing)).rejects.toThrow('R2 unavailable')
    expect({ files: stored.size, entries: await logged(mehta, deliveryAppAudit.uploaded), rows: (await versions(mehta)).length }).toEqual(before)
  })

  it('refuses a build that is not newer than the live one, a missing reason, a bad name and a missing body', async () => {
    expect(await upload('staff-super-admin', mehta, { buildNumber: 1 })).toEqual({ ok: false, code: 'BUILD_NOT_NEWER' })
    expect(await upload('staff-super-admin', mehta, { buildNumber: 5, reason: '  ' })).toEqual({ ok: false, code: 'INVALID_INPUT' })
    expect(await upload('staff-super-admin', mehta, { buildNumber: 5, versionName: '../x' })).toEqual({ ok: false, code: 'INVALID_INPUT' })
    expect(await upload('staff-super-admin', mehta, { buildNumber: 0 })).toEqual({ ok: false, code: 'INVALID_INPUT' })
    expect(await serviceFor('staff-super-admin').upload(mehta, { versionName: '1.0.1', buildNumber: 5, reason: 'x' }, null, 10)).toEqual({ ok: false, code: 'INVALID_INPUT' })
  })

  it('refuses a file past the size limit before reading it, a store that is not there, and a bucket that is not bound', async () => {
    const big = await serviceFor('staff-super-admin').upload(mehta, { versionName: '1.0.1', buildNumber: 5, reason: 'x' }, streamOf(apk()), maxApkBytes + 1)
    expect(big).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(await upload('staff-super-admin', '00000000-0000-4000-8000-000000000000', { buildNumber: 5 })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await upload('staff-super-admin', 'not-an-id', { buildNumber: 5 })).toEqual({ ok: false, code: 'NOT_FOUND' })
    expect(await upload('staff-super-admin', mehta, { buildNumber: 5 }, apk(), null)).toEqual({ ok: false, code: 'UNAVAILABLE' })
  })

  it('adds a newer build as the next version, keeping the minimum staff set', async () => {
    await serviceFor('staff-super-admin').setMinimumBuild(mehta, { minimumBuild: 1, reason: 'Nothing older exists' })
    expect(await upload('staff-super-admin', mehta, { versionName: '1.1.0', buildNumber: 2 })).toMatchObject({ ok: true, value: { version: 3, buildNumber: 2, minimumBuild: 1 } })
  })
})

describe('the minimum build', () => {
  it('is set by staff with a reason as a new version with the same file, never above the build uploaded', async () => {
    const before = await versions(mehta)
    const latestKey = async () => (await withSystemScope(db.sql, (tx) => selectLatestDeliveryApp(tx, mehta)))?.apk_key
    const keyBefore = await latestKey()
    expect(await serviceFor('staff-engineer').setMinimumBuild(mehta, { minimumBuild: 2, reason: 'The API needs build 2' })).toMatchObject({ ok: true, value: { minimumBuild: 2, buildNumber: 2 } })
    expect((await versions(mehta)).length).toBe(before.length + 1)
    expect(await latestKey()).toBe(keyBefore)
    expect(await logged(mehta, deliveryAppAudit.minimumBuildSet)).toBeGreaterThanOrEqual(2)
    expect(await serviceFor('staff-super-admin').setMinimumBuild(mehta, { minimumBuild: 3, reason: 'Too high' })).toEqual({ ok: false, code: 'MINIMUM_ABOVE_BUILD' })
    expect(await serviceFor('staff-super-admin').setMinimumBuild(mehta, { minimumBuild: null, reason: 'Back to none' })).toMatchObject({ ok: true, value: { minimumBuild: null } })
  })

  it('changes nothing when it is what is already set, and needs an uploaded APK and a role that may', async () => {
    const same = (await versions(mehta)).length
    await serviceFor('staff-super-admin').setMinimumBuild(mehta, { minimumBuild: null, reason: 'Already none' })
    expect((await versions(mehta)).length).toBe(same)
    const noApp = await storeIdOf('Harbor Coffee Co.')
    expect(await serviceFor('staff-super-admin').setMinimumBuild(noApp, { minimumBuild: 1, reason: 'x' })).toEqual({ ok: false, code: 'NO_APP' })
    expect(await serviceFor('staff-support').setMinimumBuild(mehta, { minimumBuild: 1, reason: 'x' })).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await serviceFor('staff-super-admin').setMinimumBuild(mehta, { minimumBuild: 1 })).toEqual({ ok: false, code: 'INVALID_INPUT' })
  })
})

describe('reading', () => {
  it('shows the newest version to any role that reads stores, and nothing for a store with none', async () => {
    expect(await serviceFor('staff-read-only').read(mehta)).toMatchObject({ ok: true, value: { buildNumber: 2 } })
    expect(await serviceFor('staff-read-only').read(await storeIdOf('Harbor Coffee Co.'))).toEqual({ ok: true, value: null })
  })

  it('hides a store outside a Partner manager’s assignment, whether or not it has an app', async () => {
    const manager = as('staff-partner-manager')
    const own = (await db.sql<{ id: string }[]>`
      select id from store where partner_id in (select partner_id from staff_partner_assignment where staff_user_id = ${manager.id} and removed_at is null) limit 1`)[0]?.id ?? ''
    expect(own).not.toBe('')
    const [other] = await db.sql<{ id: string }[]>`
      select id from store where partner_id not in (select partner_id from staff_partner_assignment where staff_user_id = ${manager.id} and removed_at is null) limit 1`
    expect(await serviceFor('staff-partner-manager').read(own)).toMatchObject({ ok: true })
    expect(await serviceFor('staff-partner-manager').read(other?.id ?? '')).toEqual({ ok: false, code: 'NOT_FOUND' })
  })
})

describe('the table', () => {
  it('is never readable or writable by a store’s own people, and never changed or deleted by anyone', async () => {
    const [store] = await db.sql<{ partner_id: string }[]>`select partner_id from store where id = ${mehta}`
    const merchant: TenantContext = { caller: { kind: 'person', userId: '00000000-0000-4000-8000-000000000001', sessionId: 's' }, partnerId: store?.partner_id ?? '', storeId: mehta, sellerScope: { kind: 'all' }, subscription: 'active' }
    await expect(withScope(db.sql, merchant, (tx) => tx`select 1 from store_delivery_app`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { caller: { kind: 'staff', staffId: as('staff-super-admin').id } }, (tx) => tx`update store_delivery_app set version_name = 'x'`)).rejects.toThrow(/permission denied/)
    await expect(withScope(db.sql, { caller: { kind: 'staff', staffId: as('staff-super-admin').id } }, (tx) => tx`delete from store_delivery_app`)).rejects.toThrow(/permission denied/)
  })
})

describe('the route', () => {
  const requestFor = (storeId: string, init: RequestInit & { path?: string } = {}) => new Request(`https://admin.dripfunnel.ai/api/stores/${storeId}/delivery-app${init.path ?? ''}`, init)

  it('matches only a store’s own delivery-app paths', () => {
    expect(matchDeliveryAppPath(`/api/stores/${mehta}/delivery-app`)).toEqual({ storeId: mehta, minimumBuild: false })
    expect(matchDeliveryAppPath(`/api/stores/${mehta}/delivery-app/minimum-build`)).toEqual({ storeId: mehta, minimumBuild: true })
    expect(matchDeliveryAppPath('/api/stores/x/delivery-app')).toBeNull()
    expect(matchDeliveryAppPath(`/api/stores/${mehta}/delivery-app/other`)).toBeNull()
  })

  it('answers 401 with no staff session, 403 for a role that may not, 405 for another method', async () => {
    const target = { storeId: mehta, minimumBuild: false }
    expect((await handleDeliveryApp(requestFor(mehta), target, null)).status).toBe(401)
    const denied = await handleDeliveryApp(requestFor(mehta, { method: 'POST', body: apk() as BodyInit, headers: { 'x-reason': 'x' } }), target, serviceFor('staff-support'))
    expect([denied.status, ((await denied.json()) as { code: string }).code]).toEqual([403, 'FORBIDDEN'])
    expect((await handleDeliveryApp(requestFor(mehta, { method: 'DELETE' }), target, serviceFor('staff-super-admin'))).status).toBe(405)
  })

  it('uploads with the file as the body and the reason in a header, and answers the new version', async () => {
    const bytes = apk(100)
    const response = await handleDeliveryApp(
      requestFor(maple, { method: 'POST', body: bytes as BodyInit, headers: { 'content-length': String(bytes.byteLength), 'x-reason': 'Second build' } }),
      { storeId: maple, minimumBuild: false },
      serviceFor('staff-super-admin'),
    )
    expect(response.status).toBe(400)
    const withQuery = await handleDeliveryApp(
      new Request(`https://admin.dripfunnel.ai/api/stores/${maple}/delivery-app?versionName=1.1.0&buildNumber=2`, { method: 'POST', body: bytes as BodyInit, headers: { 'content-length': String(bytes.byteLength), 'x-reason': 'Second build' } }),
      { storeId: maple, minimumBuild: false },
      serviceFor('staff-super-admin'),
    )
    expect(withQuery.status).toBe(200)
    expect(await withQuery.json()).toMatchObject({ ok: true, current: { versionName: '1.1.0', buildNumber: 2, sizeBytes: 104 } })
  })

  it('takes the reason from the query when no header carries it, for text a header can’t hold', async () => {
    const bytes = apk(8)
    const upload = (reason: string) => handleDeliveryApp(
      new Request(`https://admin.dripfunnel.ai/api/stores/${mehta}/delivery-app?${new URLSearchParams({ versionName: '1.2.0', buildNumber: '3', reason })}`, { method: 'POST', body: bytes as BodyInit, headers: { 'content-length': String(bytes.byteLength) } }),
      { storeId: mehta, minimumBuild: false },
      serviceFor('staff-super-admin'),
    )
    expect((await upload('')).status).toBe(400)
    expect((await upload('Fixes the map’s crash')).status).toBe(200)
    const [entry] = await db.sql<{ reason: string }[]>`select reason from activity_log where store_id = ${mehta} and action = ${deliveryAppAudit.uploaded} order by occurred_at desc limit 1`
    expect(entry?.reason).toBe('Fixes the map’s crash')
  })

  it('sets the minimum build from a JSON body, and reads the current version', async () => {
    const set = await handleDeliveryApp(requestFor(maple, { method: 'POST', path: '/minimum-build', body: JSON.stringify({ minimumBuild: 2, reason: 'Needs the new API' }) }), { storeId: maple, minimumBuild: true }, serviceFor('staff-engineer'))
    expect(set.status).toBe(200)
    const read = await handleDeliveryApp(requestFor(maple), { storeId: maple, minimumBuild: false }, serviceFor('staff-read-only'))
    expect(await read.json()).toMatchObject({ ok: true, current: { minimumBuild: 2, buildNumber: 2 } })
  })
})

describe('the rider-facing side', () => {
  const callerFor = async (storeId: string, available = true): Promise<DeliveryCaller> => {
    const [row] = await db.sql<{ partner_id: string }[]>`select partner_id from store where id = ${storeId}`
    return { storeId, partnerId: row?.partner_id ?? '', available, rider: null, token: null }
  }
  const download = async (storeId: string, init: RequestInit = {}, available = true, files: ApkFiles | null = bucketFiles) =>
    handleDeliveryApk(new Request('https://kesari.my-store.one/app/delivery.apk', init), db.sql, await callerFor(storeId, available), files)
  const bucketFiles: ApkFiles = { get: async (key) => (stored.has(key) ? { body: streamOf(stored.get(key) ?? new Uint8Array()) as ReadableStream } : null) }
  const minimumBuildOf = async (storeId: string) => {
    const result = await graphql({
      schema: deliverySchema,
      source: '{ minimumBuild }',
      contextValue: { sql: db.sql, caller: await callerFor(storeId), activity: activityLog, facts, defer: () => undefined, now: () => now } satisfies DeliveryContext,
    })
    return result.errors ? result.errors.map((e) => e.message) : result.data
  }

  it('streams the newest APK with the APK type, its size and no sniffing', async () => {
    const response = await download(maple)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive')
    expect(response.headers.get('content-length')).toBe('104')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="delivery-1.1.0.apk"')
    expect((await response.arrayBuffer()).byteLength).toBe(104)
  })

  it('answers 404 for a store with no app, an unavailable store or a bucket not bound, and 405 for another method', async () => {
    const none = await storeIdOf('Harbor Coffee Co.')
    expect((await download(none)).status).toBe(404)
    expect((await download(maple, {}, false)).status).toBe(404)
    expect((await download(maple, {}, true, null)).status).toBe(404)
    expect((await download(maple, { method: 'POST' })).status).toBe(405)
  })

  it('shows the Delivery API only its own store’s minimum build, null when none is set', async () => {
    expect(await minimumBuildOf(maple)).toEqual({ minimumBuild: 2 })
    expect(await minimumBuildOf(await storeIdOf('Harbor Coffee Co.'))).toEqual({ minimumBuild: null })
  })
})
