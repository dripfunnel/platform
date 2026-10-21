import { describe, expect, it } from 'vitest'
import { blockedFor, secondsLeft, sessionControls, sessionStateAt, type PortalStaffSession } from './staffSession'
import { createPortalSessionFixture, encodeFixtureHandoff, type FixtureHandoff } from './staffSessionFixture'
import { staffSessionCopy, type StaffSessionWords } from './staffSessionCopy'

const now = Date.parse('2026-10-01T09:00:00Z')
const inMinutes = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

const impersonation: FixtureHandoff = {
  id: 'imp-1',
  kind: 'impersonation',
  staffName: 'Neha Rao',
  actingAs: { name: 'Rohan Verma', role: 'Manager', where: 'Mehta Textiles' },
  partnerName: 'Bazaar Cloud',
  host: 'shop.bazaarcloud.in/mehta-textiles',
  expiresAt: inMinutes(30),
}
const setup: FixtureHandoff = { id: 'su-1', kind: 'setup', staffName: 'Maya Ortiz', actingAs: null, partnerName: 'Tallis Studio', host: 'platform.dripfunnel.com', expiresAt: inMinutes(120) }
const open = (handoff: FixtureHandoff): PortalStaffSession => ({ ...handoff, state: 'open', endedBy: null })

const words: StaffSessionWords = {
  impersonating: 'Impersonating {user}',
  impersonatingDetail: '({role}, {where}) · Support session by {staff}',
  setup: 'Setup session for {partner}',
  setupDetail: '· You’re in as {staff} (DripFunnel)',
  endsIn: 'Ends in {time}',
  end: 'End session',
  endFailed: 'That didn’t go through.',
  back: 'Back',
  action: 'Back to the admin console',
  notice: 'Support ({staff}) is signed in as {user}. Ends in {time}.',
  noticeSetup: 'DripFunnel is setting up your console: {staff}, until {time}.',
  ended: 'This session has ended',
  expired: 'Your time as {user} is up',
  expiredSetup: 'Your time is up',
  endedBody: { admin: 'Ended from the admin console.', portal: 'You ended it here.', expiry: 'It timed out.' },
}
const copy = staffSessionCopy(words, { wait: (seconds) => `${seconds / 60} min`, time: (iso) => iso.slice(11, 16) })

describe('blockedFor', () => {
  it('blocks every account control while impersonating', () => {
    for (const control of sessionControls) expect(blockedFor('impersonation', control)).toBe('BLOCKED_WHILE_IMPERSONATING')
  })

  it('leaves a setup session everything but payment, payouts and ownership', () => {
    expect(sessionControls.filter((control) => blockedFor('setup', control) !== null)).toEqual(['paymentMethod', 'payoutDetails', 'ownership'])
    expect(blockedFor('setup', 'payoutDetails')).toBe('PARTNER_ENTERS_THIS_ITSELF')
  })

  it('blocks nothing outside a staff session', () => {
    for (const control of sessionControls) expect(blockedFor(null, control)).toBeNull()
  })
})

describe('the countdown', () => {
  it('rounds up to whole minutes and stops at zero', () => {
    expect(secondsLeft(inMinutes(29.2), now)).toBe(30 * 60)
    expect(secondsLeft(inMinutes(0.1), now)).toBe(60)
    expect(secondsLeft(inMinutes(-1), now)).toBe(0)
  })

  it('reads an open session past its end as expired', () => {
    expect(sessionStateAt(open({ ...impersonation, expiresAt: inMinutes(-1) }), now)).toBe('expired')
    expect(sessionStateAt(open(impersonation), now)).toBe('open')
  })
})

describe('the portal fixture', () => {
  const fixture = () => createPortalSessionFixture({ now: () => now, sample: () => impersonation })

  it('accepts a handoff once, and refuses anything else', () => {
    const portal = fixture()
    const token = encodeFixtureHandoff(impersonation, '1')
    expect(portal.enter(token)?.state).toBe('open')
    expect(portal.enter(token)).toBeNull()
    expect(portal.enter('fx.not-a-token')).toBeNull()
    expect(portal.enter('opaque')).toBeNull()
  })

  it('records who ended it, for the card', () => {
    const portal = fixture()
    portal.enter(encodeFixtureHandoff(impersonation, '1'))
    portal.endFromAdmin('imp-1')
    expect(portal.current()).toMatchObject({ state: 'ended', endedBy: 'admin' })
  })

  it('shows each harness state', () => {
    const portal = fixture()
    portal.harness('expired')
    expect(portal.current()?.state).toBe('expired')
    portal.harness('notice')
    expect(portal.notice()?.state).toBe('open')
  })
})

describe('the banner words', () => {
  it('say Support on an impersonation, never DripFunnel', () => {
    const bar = copy.bar(open(impersonation), 1800)
    const text = `${bar.lead} ${bar.detail} ${bar.timeLeft} ${copy.notice(open(impersonation), 1800)}`
    expect(text).toBe('Impersonating Rohan Verma (Manager, Mehta Textiles) · Support session by Neha Rao Ends in 30 min Support (Neha) is signed in as Rohan. Ends in 30 min.')
    expect(text).not.toContain('DripFunnel')
  })

  it('name DripFunnel on a setup session', () => {
    const bar = copy.bar(open(setup), 7200)
    expect(`${bar.lead} ${bar.detail}`).toBe('Setup session for Tallis Studio · You’re in as Maya Ortiz (DripFunnel)')
    expect(copy.notice(open(setup), 7200)).toBe('DripFunnel is setting up your console: Maya, until 11:00.')
  })

  it('say how it ended', () => {
    expect(copy.over({ ...open(impersonation), state: 'expired', endedBy: 'expiry' })).toEqual({ title: 'Your time as Rohan is up', body: 'It timed out.' })
    expect(copy.over({ ...open(setup), state: 'expired', endedBy: 'expiry' }).title).toBe('Your time is up')
    expect(copy.over({ ...open(impersonation), state: 'ended', endedBy: 'admin' })).toEqual({ title: 'This session has ended', body: 'Ended from the admin console.' })
  })
})
