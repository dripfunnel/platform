import { describe, expect, it } from 'vitest'
import { staffRoles, type StaffRole } from '../features/shell/staffRoles'
import type { ActivityFilter } from './activity'
import { createActivityServer, generateActivity, samplePeople } from './activitySample'

const now = Date.parse('2026-09-30T12:00:00Z')
const seed = generateActivity(now)

const serverAt = (cap?: number) => {
  let clock = now
  const pending: (() => void)[] = []
  const server = createActivityServer(seed, {
    now: () => clock,
    wait: (_ms, then) => void pending.push(then),
    link: () => 'blob:activity',
    ...(cap === undefined ? {} : { cap }),
  })
  return {
    server,
    finish: () => pending.splice(0).forEach((then) => then()),
    advance: (minutes: number) => void (clock += minutes * 60_000),
  }
}

const list = (filter: ActivityFilter, caller: StaffRole = 'staff-super-admin') => serverAt().server.list(filter, {}, 50, caller)

describe('the sample activity server', () => {
  it('serves pages of 50, newest first, with both cursors and no total', () => {
    const { server } = serverAt()
    const first = server.list({}, {}, 50, 'staff-super-admin')
    expect(first.items).toHaveLength(50)
    expect(first.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: true })
    expect(Object.keys(first)).not.toContain('total')
    const times = first.items.map((entry) => entry.occurredAt)
    expect(times).toEqual([...times].sort().reverse())

    const second = server.list({}, { after: first.pageInfo.endCursor ?? undefined }, 50, 'staff-super-admin')
    expect(second.pageInfo.hasPreviousPage).toBe(true)
    expect(second.items.map((entry) => entry.id)).not.toContain(first.items[0]?.id)
    const back = server.list({}, { before: second.pageInfo.startCursor ?? undefined }, 50, 'staff-super-admin')
    expect(back.items.map((entry) => entry.id)).toEqual(first.items.map((entry) => entry.id))
  })

  it.each([
    ['action', { action: 'store.suspended' }, (e: (typeof seed)[number]) => e.action === 'store.suspended'],
    ['result', { result: 'denied' }, (e: (typeof seed)[number]) => e.result === 'denied'],
    ['level', { level: 'security' }, (e: (typeof seed)[number]) => e.level === 'security'],
    ['actor kind', { actor: 'api_key' }, (e: (typeof seed)[number]) => e.actor.kind === 'api_key'],
    ['partner', { partner: 'kl' }, (e: (typeof seed)[number]) => e.partner?.id === 'kl'],
    ['store', { store: 's1' }, (e: (typeof seed)[number]) => e.store?.id === 's1'],
    ['target', { target: 'store:s4' }, (e: (typeof seed)[number]) => e.target?.type === 'store' && e.target.id === 's4'],
    ['IP', { ip: '103.21.' }, (e: (typeof seed)[number]) => (e.ip ?? '').startsWith('103.21.')],
  ] as const)('filters by %s', (_name, filter, holds) => {
    const items = list(filter).items
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(holds)).toBe(true)
  })

  it('follows one impersonation and one setup session through all their entries', () => {
    const impersonation = list({ imp: 'imp-7Q2' }).items
    expect(impersonation.map((entry) => entry.action)).toEqual(['impersonation.ended', 'storefront.published', 'product.updated', 'impersonation.started'])
    expect(list({ su: 'su-4K9' }).items).toHaveLength(4)
  })

  it('gives a person their timeline, including what they did as someone else', () => {
    const items = list({ person: 'st-neha' }).items
    expect(items.every((entry) => entry.actor.id === 'st-neha' || entry.onBehalfOf?.id === 'st-neha')).toBe(true)
    expect(items.some((entry) => entry.onBehalfOf?.id === 'st-neha' && entry.actor.id === 'pe-s1')).toBe(true)
  })

  it("scopes a customer's tab to their own storefront events", () => {
    const customer = seed.find((entry) => entry.actor.kind === 'customer')?.actor.id?.replace(/^cu-/, '')
    expect(customer).toBeDefined()
    const items = list({ customer }).items
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((entry) => entry.level === 'storefront')).toBe(true)
  })

  it('keeps to UTC days for presets and a custom range', () => {
    expect(list({ date: 'today' }).items.every((entry) => entry.occurredAt.startsWith('2026-09-30'))).toBe(true)
    const range = list({ from: '2026-09-20', to: '2026-09-21' }).items
    expect(range.length).toBeGreaterThan(0)
    expect(range.every((entry) => entry.occurredAt >= '2026-09-20' && entry.occurredAt < '2026-09-22')).toBe(true)
  })

  it('finds at most 8 people, from 2 characters, and says where each belongs', () => {
    const { server } = serverAt()
    expect(server.people('p', 8)).toEqual([])
    const found = server.people('a', 8)
    expect(found.length).toBeLessThanOrEqual(8)
    expect(server.people('ma', 8).every((match) => match.where !== '')).toBe(true)
  })

  it('shows a person card that points at the other accounts with the same email', () => {
    const { server } = serverAt()
    expect(server.person('st-neha')?.memberships).toEqual([{ where: 'DripFunnel', role: 'Support' }])
    for (const person of samplePeople) {
      const others = samplePeople.filter((other) => other.id !== person.id && other.email === person.email)
      expect(server.person(person.id)?.sameEmailAccounts).toBe(person.email ? others.length : 0)
    }
    expect(samplePeople.some((person) => person.sameEmailAccounts > 0)).toBe(true)
    expect(server.person('nobody')).toBeNull()
  })
})

describe('the sample export', () => {
  const exporters: readonly StaffRole[] = ['staff-super-admin', 'staff-engineer']

  it.each(staffRoles)('lets only a Super admin or the Engineer on call export, for %s', (role) => {
    const { server } = serverAt()
    const allowed = exporters.includes(role)
    expect(server.list({}, {}, 50, role).export).toEqual(allowed ? { allowed: true } : { allowed: false, reason: 'EXPORTERS_ONLY' })
    if (allowed) expect(() => server.startExport({}, role)).not.toThrow()
    else expect(() => server.startExport({}, role)).toThrow()
  })

  it('records the export, is ready with a link, and the link expires after an hour', () => {
    const { server, finish, advance } = serverAt()
    const job = server.startExport({ store: 's1' }, 'staff-engineer')
    expect(job.state).toBe('preparing')
    const latest = server.list({}, {}, 50, 'staff-super-admin').items[0]
    expect(latest).toMatchObject({ action: 'activity.exported', actor: { id: 'st-lena' } })

    finish()
    const ready = server.exportJob(job.id)
    expect(ready).toMatchObject({ state: 'ready', url: 'blob:activity', expiresAt: new Date(now + 60 * 60_000).toISOString() })
    expect(ready?.entries).toBeGreaterThan(0)

    advance(59)
    expect(server.exportJob(job.id)?.state).toBe('ready')
    advance(1)
    expect(server.exportJob(job.id)).toMatchObject({ state: 'expired', url: null })
  })

  it('refuses to build an export over the cap and asks for a narrower filter', () => {
    const { server, finish } = serverAt(10)
    const job = server.startExport({}, 'staff-super-admin')
    finish()
    expect(server.exportJob(job.id)).toMatchObject({ state: 'tooLarge', url: null })
  })
})
