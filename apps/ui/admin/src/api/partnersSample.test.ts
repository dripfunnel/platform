import { describe, expect, it } from 'vitest'
import { createSampleServer, permissionsFor, samplePartners, type SamplePartner } from './partnersSample'

const server = () => createSampleServer(samplePartners, () => '2026-09-30T10:00:00Z')
const partner = (id: string): SamplePartner => {
  const found = samplePartners.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`No sample partner ${id}`)
  return found
}

describe('the sample Partners list', () => {
  it('lists newest first, with the columns FIRST-RELEASE.md §4.1 names', () => {
    const page = server().list({}, {}, 25, 'staff-super-admin')
    expect(page.items.map((row) => row.id)).toEqual(['ts', 'nl', 'kl', 'lt', 'ns', 'bz', 'df'])
    expect(page.items).toHaveLength(7)
    expect(page.items.find((row) => row.id === 'kl')).toMatchObject({
      portalHost: { host: 'shop.kaufladen.de', status: 'live' },
      setup: { done: 7, total: 9 },
      owner: { email: 'jonas@kaufladen.de', invitation: 'active' },
    })
  })

  it('filters by state and by setup complete', () => {
    expect(server().list({ status: 'draft' }, {}, 25, 'staff-super-admin').items.map((row) => row.id)).toEqual(['ts', 'nl'])
    expect(server().list({ setup: 'complete' }, {}, 25, 'staff-super-admin').items).toHaveLength(4)
    expect(server().list({ setup: 'incomplete' }, {}, 25, 'staff-super-admin').items).toHaveLength(3)
  })

  it('searches name, host and owner email, and nothing else', () => {
    const search = (q: string) => server().list({ q }, {}, 25, 'staff-super-admin').items.map((row) => row.id)
    expect(search('bazaar')).toEqual(['bz'])
    expect(search('SHOP.KAUFLADEN')).toEqual(['kl'])
    expect(search('ben@tallis')).toEqual(['ts'])
    expect(search('Jonas Weber')).toEqual([])
  })

  it('pages by cursor both ways, never past either end', () => {
    const first = server().list({}, {}, 3, 'staff-super-admin')
    expect(first.items.map((row) => row.id)).toEqual(['ts', 'nl', 'kl'])
    expect(first.pageInfo).toMatchObject({ hasPreviousPage: false, hasNextPage: true, endCursor: 'kl' })
    const second = server().list({}, { after: 'kl' }, 3, 'staff-super-admin')
    expect(second.items.map((row) => row.id)).toEqual(['lt', 'ns', 'bz'])
    expect(second.pageInfo).toMatchObject({ hasPreviousPage: true, hasNextPage: true, startCursor: 'lt' })
    const back = server().list({}, { before: 'lt' }, 3, 'staff-super-admin')
    expect(back.items.map((row) => row.id)).toEqual(['ts', 'nl', 'kl'])
    const last = server().list({}, { after: 'bz' }, 3, 'staff-super-admin')
    expect(last.items.map((row) => row.id)).toEqual(['df'])
    expect(last.pageInfo.hasNextPage).toBe(false)
  })

  it('lets only a Super admin or Partner manager create a partner', () => {
    expect(server().list({}, {}, 25, 'staff-partner-manager').create).toEqual({ allowed: true })
    expect(server().list({}, {}, 25, 'staff-support').create).toEqual({ allowed: false, reason: 'PARTNER_ADMINS_ONLY' })
  })
})

describe('what each partner allows, as the API would answer', () => {
  it('offers Approve and Send back only while awaiting, and refuses Approve while a check fails', () => {
    const actions = permissionsFor(partner('kl'), 'staff-super-admin')
    expect(actions.approve).toEqual({ allowed: false, reason: 'GO_LIVE_CHECKS_FAILING', failingChecks: ['emailDomain'] })
    expect(actions.sendBack).toEqual({ allowed: true })
    expect(permissionsFor(partner('ns'), 'staff-super-admin').approve).toBeUndefined()
  })

  it('lets only a Super admin pause, and never the house partner', () => {
    expect(permissionsFor(partner('ns'), 'staff-super-admin').pause).toEqual({ allowed: true })
    expect(permissionsFor(partner('ns'), 'staff-partner-manager').pause).toEqual({ allowed: false, reason: 'SUPER_ADMIN_ONLY' })
    expect(permissionsFor(partner('df'), 'staff-super-admin').pause).toEqual({ allowed: false, reason: 'HOUSE_PARTNER' })
  })

  it('offers Send for a held invitation and Resend for a sent one, to Support too', () => {
    expect(permissionsFor(partner('nl'), 'staff-support').sendInvite).toEqual({ allowed: true })
    expect(permissionsFor(partner('ts'), 'staff-support').resendInvite).toEqual({ allowed: true })
    expect(permissionsFor(partner('ts'), 'staff-finance').resendInvite).toEqual({ allowed: false, reason: 'INVITERS_ONLY' })
    expect(permissionsFor(partner('ns'), 'staff-super-admin').sendInvite).toBeUndefined()
  })

  it('offers nothing on a closed partner', () => {
    expect(permissionsFor({ ...partner('ns'), state: 'closed' }, 'staff-super-admin')).toEqual({})
  })
})

describe('the sample actions', () => {
  it('moves the partner to its next state and records the reason', () => {
    const sample = server()
    sample.run('ns', 'pause', 'Contract under review')
    const paused = sample.get('ns', 'staff-super-admin')
    expect(paused?.state).toBe('paused')
    expect(paused?.actions.resume).toEqual({ allowed: true })
    expect(paused?.history.at(-1)).toMatchObject({ action: 'partner.paused', note: 'Contract under review' })
  })

  it('marks a held invitation as sent', () => {
    const sample = server()
    sample.run('nl', 'sendInvite', null)
    expect(sample.get('nl', 'staff-super-admin')?.owner).toMatchObject({ invitation: 'sent', invitationSentAt: '2026-09-30T10:00:00Z' })
  })

  it('answers an unknown partner with nothing', () => {
    expect(server().get('nope', 'staff-super-admin')).toBeNull()
  })
})

describe('the sample Approvals rule', () => {
  const kl = partner('kl')
  const passing: SamplePartner = { ...kl, checks: { ...kl.checks, emailDomain: true } }
  const withSetUp = (by: string | null): SamplePartner => ({
    ...passing,
    history: passing.history.filter((entry) => entry.action !== 'partner.set_up').concat(by ? [{ at: '2026-09-15T00:00:00Z', action: 'partner.set_up', by, note: null }] : []),
  })

  it('says who set a submitted partner up, and when it was submitted', () => {
    expect(server().list({ status: 'awaiting' }, {}, 25, 'staff-super-admin').items[0]).toMatchObject({
      id: 'kl',
      submittedAt: '2026-09-26T09:40:00Z',
      approval: { setUpBy: 'Priya Shah', rule: 'second', approvals: 0 },
    })
    const live = server().list({ status: 'live' }, {}, 25, 'staff-super-admin').items
    expect(live.every((row) => row.approval === null && row.submittedAt === null)).toBe(true)
  })

  it('lets a Super admin who ran the setup approve alone, and needs two when the partner set itself up', () => {
    expect(createSampleServer([withSetUp('Arjun Menon')]).get('kl', 'staff-super-admin')?.approval).toEqual({ setUpBy: 'Arjun Menon', rule: 'alone', approvals: 0 })
    expect(createSampleServer([withSetUp(null)]).get('kl', 'staff-super-admin')?.approval).toEqual({ setUpBy: null, rule: 'two', approvals: 0 })
  })

  it('refuses Approve to the Partner manager who ran the setup, and not to anyone else', () => {
    expect(permissionsFor(withSetUp('Priya Shah'), 'staff-partner-manager').approve).toEqual({ allowed: false, reason: 'SET_UP_BY_CALLER' })
    expect(permissionsFor(withSetUp('Maya Ortiz'), 'staff-partner-manager').approve).toEqual({ allowed: true })
    expect(permissionsFor(withSetUp('Arjun Menon'), 'staff-super-admin').approve).toEqual({ allowed: true })
  })

  it('names failing checks before the setup rule, so the reason says what would unblock it', () => {
    expect(permissionsFor(kl, 'staff-partner-manager').approve).toMatchObject({ allowed: false, reason: 'GO_LIVE_CHECKS_FAILING' })
  })

  it('sorts the queue oldest submitted first', () => {
    const later: SamplePartner = { ...withSetUp(null), id: 'later', history: [{ at: '2026-09-29T00:00:00Z', action: 'partner.submitted', by: null, note: null }] }
    const sample = createSampleServer([later, passing])
    expect(sample.list({ status: 'awaiting', sort: 'oldestSubmitted' }, {}, 25, 'staff-super-admin').items.map((row) => row.id)).toEqual(['kl', 'later'])
  })
})
