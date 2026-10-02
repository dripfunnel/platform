import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { loadMe } from './me'
import { loadNavBadges } from './navBadges'
import { search } from './search'

afterEach(() => void vi.unstubAllGlobals())

describe('the shell queries', () => {
  it('reads the signed-in staff member, and null when nobody is', async () => {
    stubApi({ data: { me: { id: 'st1', name: 'Arjun Menon', email: 'arjun@softobotics.example', role: 'staff-super-admin' } } })
    expect(await loadMe()).toMatchObject({ role: 'staff-super-admin' })
    stubApi({ data: { me: null } })
    expect(await loadMe()).toBeNull()
  })

  it('refuses a role this console does not know', async () => {
    stubApi({ data: { me: { id: 'st1', name: 'X', email: 'x@example', role: 'staff-ceo' } } })
    await expect(loadMe()).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('counts a withheld openSessions as nothing to badge', async () => {
    stubApi({ data: { navBadges: { partnersAwaitingApproval: 1, provisioningAttention: 2, openSessions: null } } })
    expect(await loadNavBadges()).toEqual({ partnersAwaitingApproval: 1, provisioningAttention: 2, openSessions: 0 })
  })

  it('searches partners and stores and reads store statuses in the console vocabulary', async () => {
    const stub = stubApi({
      data: {
        search: {
          partners: [{ id: 'p1', name: 'Kaufladen Digital', state: 'awaiting', host: 'shop.kaufladen.example', ownerEmail: null }],
          stores: [{ id: 's1', name: 'Kiko Kids', code: 'kiko-kids', status: 'past_due', partnerName: 'Bazaar Cloud', ownerEmail: null, host: null }],
        },
      },
    })
    const result = await search('kiko')
    expect(stub.calls[0]?.variables).toEqual({ query: 'kiko' })
    expect(result.stores[0]?.status).toBe('pastdue')
    expect(result.partners[0]?.state).toBe('awaiting')
  })
})
