import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CallerContext } from '#core/tenancy'
import { roleFor, settingsFor, type RlsSettings } from '#db/rls/settings'
import { withScope } from '#db/scoped/index'
import { createTestDatabase, type TestDatabase } from './support/database'

// What `withScope` sends before the work (DATA-MODEL.md §5.1, §5.3; #478): the caller's role
// and every app.* setting, the settings in one statement with their values as parameters.

let db: TestDatabase
let sent: { query: string; parameters: unknown[] }[]
let counted: postgres.Sql

beforeAll(async () => {
  db = await createTestDatabase()
  sent = []
  counted = postgres(db.url, { max: 1, fetch_types: false, debug: (_connection, query, parameters) => void sent.push({ query: query.trim(), parameters }) })
}, 60_000)

afterAll(async () => {
  await counted?.end()
  await db?.drop()
})

const store = { partnerId: 'partner-1', storeId: 'store-1', sellerScope: { kind: 'all' as const }, subscription: 'active' as const }

const person: CallerContext = { ...store, caller: { kind: 'person', userId: 'user-1', sessionId: 'session-1' } }

const callers: [string, CallerContext][] = [
  ['a store person', person],
  ['a supplier user', { ...store, sellerScope: { kind: 'seller', sellerId: 'seller-1' }, caller: { kind: 'person', userId: 'user-2', sessionId: 'session-2' } }],
  ['an API key', { ...store, caller: { kind: 'api-key', keyId: 'key-1', createdByUserId: 'user-3' } }],
  ['an app', { ...store, caller: { kind: 'app', grantId: 'grant-1', appId: 'app-1' } }],
  ['a store impersonation', { ...store, caller: { kind: 'impersonation', impersonationId: 'imp-1', staffId: 'staff-1', userId: 'user-4' } }],
  ['a support session', { ...store, caller: { kind: 'support', supportSessionId: 'support-1', partnerUserId: 'pu-1', access: 'write' } }],
  ['a signed-in shopper', { ...store, caller: { kind: 'shopper', customerId: 'customer-1', orderTokenHash: 'hash-1' } }],
  ['a guest shopper', { ...store, caller: { kind: 'shopper', customerId: null } }],
  ['a partner user', { partnerId: 'partner-2', caller: { kind: 'partner-user', partnerUserId: 'pu-2' } }],
  ['a partner impersonation', { partnerId: 'partner-2', caller: { kind: 'impersonation', partnerUserId: 'pu-3', staffId: 'staff-2', impersonationId: 'imp-2' } }],
  ['a staff setup session', { partnerId: 'partner-2', caller: { kind: 'staff-setup', staffId: 'staff-3', setupSessionId: 'setup-1' } }],
  ['a staff member', { caller: { kind: 'staff', staffId: 'staff-4' } }],
]

const inScope = async (context: CallerContext, sql: postgres.Sql = db.sql): Promise<{ role: string; settings: Record<string, string> }> =>
  withScope(sql, context, async (tx) => {
    const [who] = await tx<{ role: string }[]>`select current_user::text as role`
    const settings: Record<string, string> = {}
    for (const name of Object.keys(settingsFor(context))) {
      const [row] = await tx<{ value: string }[]>`select current_setting(${name}) as value`
      settings[name] = row?.value ?? ''
    }
    return { role: who?.role ?? '', settings }
  })

describe('withScope', () => {
  it.each(callers)('sets the role and every app.* setting for %s', async (_name, context) => {
    expect(await inScope(context)).toEqual({ role: roleFor(context), settings: settingsFor(context) })
  })

  it('sends the settings in one statement, between the role and the work', async () => {
    const context = person
    sent.length = 0
    await withScope(counted, context, async (tx) => tx`select 'work'`)
    const queries = sent.map(({ query }) => query.replaceAll(/\s+/g, ' '))
    expect(queries).toHaveLength(5)
    expect([queries[0], queries[1], queries[3], queries[4]]).toEqual(['begin', `set local role ${roleFor(context)}`, "select 'work'", 'commit'])
    expect(queries[2]).toMatch(/^select set_config\(name, value, true\) from unnest\(\$1::text\[\], \$2::text\[\]\)/)
  })

  it('passes every name and value as a parameter, never in the SQL text', async () => {
    const context = person
    sent.length = 0
    await withScope(counted, context, async () => undefined)
    const statement = sent.find(({ query }) => query.includes('set_config'))
    for (const value of ['partner-1', 'store-1', 'user-1', 'app.scope']) expect(statement?.query).not.toContain(value)
    expect(statement?.parameters.join(' ')).toContain('user-1')
  })

  it('round-trips values with quotes, commas, backslashes, braces and the word NULL', async () => {
    const awkward = `o'brien, "the" {1,2} \\ NULL`
    const context: CallerContext = { ...store, storeId: awkward, caller: { kind: 'shopper', customerId: 'NULL', orderTokenHash: '' } }
    const { settings } = await inScope(context)
    expect(settings).toMatchObject({ 'app.store_id': awkward, 'app.customer_id': 'NULL', 'app.order_token_hash': '' } satisfies Partial<RlsSettings>)
  })

  it('keeps the settings to the transaction, on the same connection', async () => {
    await inScope(person, counted)
    const [row] = await counted<{ scope: string | null }[]>`select current_setting('app.scope', true) as scope`
    expect(row?.scope ?? '').toBe('')
  })
})
