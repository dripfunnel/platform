import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi, stubApiSequence } from '../testing/apiStub'
import { loadMySessions, loadTarget, loadTargets, startImpersonation, startSetupSession } from './impersonation'

afterEach(() => void vi.unstubAllGlobals())

const target = (id: string, membership: string) => ({ id, name: 'Nimbus Owner', email: 'owner@nimbus.example', kind: 'storeUser', memberships: [{ id: membership, level: 'store', partner: { id: 'p1', name: 'Northstar' }, store: { id: 's1', name: 'Nimbus' }, role: 'owner', supplier: null }], lastSignInAt: null, status: 'active', impersonate: { allowed: true, reason: null, failingChecks: null }, openSession: null })
const page = (items: unknown[], next: string | null) => ({ data: { impersonationTargets: { items, pageInfo: { startCursor: null, endCursor: next, hasPreviousPage: false, hasNextPage: next !== null }, partners: [] } } })

describe('loadTargets', () => {
  it('sends the role as the API’s key and reads the membership roles back as the console’s', async () => {
    const stub = stubApi(page([target('t1', 'm1')], null))
    const found = await loadTargets({ role: 'readOnly', ...({ state: 'denied' } as object) }, {}, null)
    expect(stub.calls[0]?.variables).toEqual({ filter: { role: 'partner-read-only' }, search: null })
    expect(found?.items[0]?.memberships[0]).toMatchObject({ level: 'store', role: 'owner' })
  })

  it('reads FORBIDDEN as the no-access view', async () => {
    stubApi({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] })
    expect(await loadTargets({}, {}, null)).toBeNull()
  })
})

describe('loadTarget', () => {
  it('pages through the place until it finds the membership', async () => {
    const stub = stubApiSequence(page([target('t1', 'm1')], 'c1'), page([target('t2', 'm2')], null))
    expect((await loadTarget('m2', { email: 'owner@nimbus.example', store: 's1' }))?.id).toBe('t2')
    expect(stub.calls[1]?.variables).toMatchObject({ after: 'c1', search: 'owner@nimbus.example', filter: { store: 's1' } })
  })

  it('finds nobody without an email to look for, and nobody when the pages run out', async () => {
    const stub = stubApi(page([target('t1', 'm1')], null))
    expect(await loadTarget('m9', { email: '', partner: 'p1' })).toBeNull()
    expect(stub.calls).toHaveLength(0)
    expect(await loadTarget('m9', { email: 'x@y.example', partner: 'p1' })).toBeNull()
  })
})

describe('starting', () => {
  it('reads REAUTH_REQUIRED as a refusal the dialog acts on', async () => {
    stubApi({ data: { startImpersonation: { ok: false, reason: 'REAUTH_REQUIRED', handoff: null, session: null } } })
    expect(await startImpersonation('t1', 'm1', 'Fixing', null)).toEqual({ ok: false, reason: 'REAUTH_REQUIRED' })
  })

  it('builds a setup session from the link and the dialog’s facts', async () => {
    stubApi({ data: { startPartnerSetupSession: { ok: true, code: null, handoff: 'https://platform.localhost/impersonate/enter?token=abc', sessionId: 'su1', expiresAt: '2026-10-04T12:00:00.000Z' } } })
    const started = await startSetupSession({ id: 'p1', name: 'Tallis' }, 'Setup', null, 'Priya')
    expect(started).toMatchObject({ ok: true, handoff: 'https://platform.localhost/impersonate/enter?token=abc', session: { id: 'su1', kind: 'setup', host: 'platform.localhost', staff: { name: 'Priya' } } })
  })

  it('shows no sessions to a role that may open none', async () => {
    stubApi({ errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] })
    expect(await loadMySessions()).toEqual([])
  })
})
